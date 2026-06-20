// routes.js
import fs from 'fs/promises';
import path from 'path';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { asyncHandler, maskSensitive, extractAlgorithmItems, extractRentalInfo, extractRigInfo } from './utils.js';
import { mrrApiCall, mrrRequest, fetchAggregatedRentals, mrrConfigs, defaultMrrClient } from './mrr.js';
import { resolveNhClient, getNiceHashApp, nhConfigs, isAggregate, normalizeAlgoForNiceHash, mapNiceHashToMRR, getCachedNhPools } from './nh.js';
import { sendTelegramInternal, runRentalMonitor, getTelegramStatus, setTelegramStatus } from './monitor.js';
import { handleMiningOpportunityScan } from './miningOpportunityNotifier.js';
import { db } from './db.js';
import { saveMiningTrainingSnapshot } from './miningTrainingDb.js';
import { getAlgorithmUnit } from '../src/core/mapping.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');

/** In-memory cache for CoinGecko prices with TTL */
const coinGeckoCache = new Map();
const COINGECKO_CACHE_TTL = 60000; // 1 minute

/** Hardcoded fallback BTC rates for common coins when APIs are unavailable (approximate, last updated) */
const FALLBACK_BTC_RATES = {
  bitcoin: 1,
  ethereum: 0.052,    // ~$3100 ETH / $60000 BTC
  'ethereum-classic': 0.00042,
  litecoin: 0.00078,
  dogecoin: 0.0000018,
  ravencoin: 0.00000025,
  monero: 0.0012,
  kaspa: 0.000034,
};

/** Fallback CoinGecko price (USD, BTC) when API is unavailable */
function buildFallbackPrices(ids) {
  const result = {};
  const coins = ids.split(',').map(s => s.trim());
  for (const coin of coins) {
    const btcRate = FALLBACK_BTC_RATES[coin];
    if (btcRate !== undefined) {
      result[coin] = { usd: 0, btc: btcRate };
    } else {
      result[coin] = { usd: 0, btc: 0 };
    }
  }
  // Always ensure bitcoin has a valid rate
  if (!result['bitcoin']) result['bitcoin'] = { usd: 0, btc: 1 };
  return result;
}

/** Helper to save JSON data to SQLite database */
async function saveToDatabase(filename, items) {
  if (!items || !Array.isArray(items) || items.length === 0) return;
  const tableName = filename.replace('.csv', '').replace(/-/g, '_');
  const filePath = path.join(DATA_DIR, filename);
  const columns = Object.keys(items[0]);
  const quotedColumns = columns.map(c => `"${c}"`);
  const placeholders = columns.map(() => '?').join(', ');
  const columnDefs = columns.map(c => {
    if (c === 'id') return '"id" TEXT PRIMARY KEY';
    return `"${c}" TEXT`;
  }).join(', ');

  try {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefs})`);
      const stmt = db.prepare(`INSERT OR REPLACE INTO ${tableName} (${quotedColumns.join(', ')}) VALUES (${placeholders})`);
      items.forEach(item => {
        const values = columns.map(c => {
          const v = item[c];
          return typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
        });
        stmt.run(...values);
      });
      stmt.finalize();
    });
  } catch (err) {
    console.error(`[db] Failed to save to ${tableName}:`, err.message);
  }
}

export function registerRoutes(app) {
  app.use('/api/v2', (req, res, next) => {
    if (req.path.startsWith('/mrr/') || req.path === '/algos/mapping' || req.path === '/extracted-pools') return next();
    try {
      const { client, clientName } = resolveNhClient(req.query.client);
      if (client) {
        req.nhApp = getNiceHashApp(client);
        res.set('X-NH-Client', clientName);
      }
      next();
    } catch (err) {
      next();
    }
  });

  app.get('/api/v2/time', asyncHandler(async (req, res) => res.json(await req.nhApp.public.getTime())));
  app.get('/api/v2/algorithms', asyncHandler(async (req, res) => res.json(await req.nhApp.public.getAlgorithms())));
  app.get('/api/v2/public/currency-algos', asyncHandler(async (req, res) => res.json(await req.nhApp.easyMining.getCurrencyAlgos())));
  app.get('/api/v2/mining/markets', asyncHandler(async (req, res) => res.json(await req.nhApp.public.getMarkets())));
  app.get('/api/v2/public/stats/24h', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.getGlobalStats24h())));

  app.get('/api/v2/algos/mapping', asyncHandler(async (req, res) => {
    const { client: nhClient, clientName: nhClientName } = resolveNhClient(req.query.client);
    const nhResponse = await getNiceHashApp(nhClient).public.getAlgorithms();
    const { data: mrrResponse, clientName } = await mrrApiCall({ endpoint: '/info/algos', method: 'GET', clientNameRaw: req.query.client });

    const nhItems = extractAlgorithmItems(nhResponse, ['miningAlgorithms', 'algorithms', 'data', 'list', 'result', 'items']);
    const mrrItems = extractAlgorithmItems(mrrResponse, ['algos', 'algorithms', 'data', 'list', 'result', 'items']);

    const mrrSlugSet = new Set(
      mrrItems
        .map((item) => String(item?.algo || item?.name || item?.slug || '').toLowerCase())
        .filter(Boolean),
    );

    const mapping = nhItems.map((item) => {
      const nicehash = String(item?.algorithm || item?.name || item?.algo || '').toUpperCase();
      const mrr = mapNiceHashToMRR(nicehash);
      return {
        nicehash,
        mrr,
        mrrExists: mrrSlugSet.has(String(mrr).toLowerCase()),
      };
    }).filter((item) => item.nicehash);

    res.set('X-MRR-Client', clientName);
    res.set('X-NH-Client', nhClientName);
    res.json({
      success: true,
      data: {
        mapping,
        totals: {
          nicehash: nhItems.length,
          mrr: mrrItems.length,
          mapped: mapping.length,
        },
      },
    });
  }));

  app.get('/api/v2/accounting/balances', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || 'BT').toUpperCase();
    if (isAggregate(clientParam)) {
      const nhAccounts = Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && nhConfigs[k].orgId);

      // Group by resolved client name to avoid redundant calls to the same underlying account
      const clientMap = new Map();
      for (const acct of nhAccounts) {
        const { client, clientName } = resolveNhClient(acct);
        if (client && !clientMap.has(clientName) && (acct === 'BT' || clientName !== 'BT')) {
          clientMap.set(clientName, client);
        }
      }

      const results = await Promise.all(Array.from(clientMap.entries()).map(async ([clientName, client]) => {
        try {
          const data = await getNiceHashApp(client).accounting.getBalances();
          return data ? { client: clientName, data } : null;
        } catch (e) { return null; }
      }));

      const filteredResults = results.filter(Boolean);

      if (filteredResults.length === 0) return res.json({ currencies: [], total: { available: '0', pending: '0', totalBalance: '0', currency: 'BTC' } });

      const total = { available: 0, pending: 0, totalBalance: 0, currency: 'BTC' };
      const allCurrencies = [];
      filteredResults.forEach(r => {
        total.available += parseFloat(r.data.total?.available || 0);
        total.pending += parseFloat(r.data.total?.pending || 0);
        total.totalBalance += parseFloat(r.data.total?.totalBalance || 0);
        if (r.data.currencies) allCurrencies.push(...r.data.currencies.map(c => ({ ...c, nhClient: r.client })));
      });

      return res.json({
        currencies: allCurrencies,
        total: {
          available: total.available.toFixed(8),
          pending: total.pending.toFixed(8),
          totalBalance: total.totalBalance.toFixed(8),
          currency: 'BTC',
        },
      });
    }
    res.json(await req.nhApp.accounting.getBalances());
  }));

  app.get('/api/v2/accounting/balance/:currency', asyncHandler(async (req, res) => res.json(await req.nhApp.accounting.getBalance(req.params.currency))));
  app.post('/api/v2/accounting/withdrawal', asyncHandler(async (req, res) => res.json(await req.nhApp.accounting.createWithdrawal(req.body))));
  app.get('/api/v2/mining/address', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.getMiningAddress())));

  app.get('/api/v2/mining/rigs2', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || 'BT').toUpperCase();
    if (isAggregate(clientParam)) {
      const nhAccounts = Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && nhConfigs[k].orgId && !isAggregate(k));

      const clientMap = new Map();
      for (const acct of nhAccounts) {
        const { client, clientName } = resolveNhClient(acct);
        if (client && !clientMap.has(clientName) && (acct === 'BT' || clientName !== 'BT')) {
          clientMap.set(clientName, client);
        }
      }

      const results = await Promise.all(Array.from(clientMap.entries()).map(async ([clientName, client]) => {
        try {
          const data = await getNiceHashApp(client).mining.getRigs();
          return (data?.miningRigs || []).map(r => ({ ...r, nhClient: clientName }));
        } catch (e) { return []; }
      }));

      return res.json({ miningRigs: results.flat() });
    }
    res.json(await req.nhApp.mining.getRigs());
  }));

  app.get('/api/v2/mining/rig/:rigId', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.getRigDetails(req.params.rigId))));
  app.post('/api/v2/mining/rigs/status', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.setRigStatus(req.body))));
  app.get('/api/v2/mining/payouts', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.getPayouts())));
  app.get('/api/v2/mining/history', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.getRigsStatsHistory(req.query))));
  app.get('/api/v2/mining/algo-stats', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.getAlgoStats())));

  app.get('/api/v2/hashpower/myOrders', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || 'BT').toUpperCase();
    const query = { ...req.query };
    if (!query.ts) query.ts = Date.now().toString();

    let data;
    if (isAggregate(clientParam)) {
      const nhAccounts = Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && nhConfigs[k].orgId && !isAggregate(k));

      const clientMap = new Map();
      for (const acct of nhAccounts) {
        const { client, clientName } = resolveNhClient(acct);
        if (client && !clientMap.has(clientName) && (acct === 'BT' || clientName !== 'BT')) {
          clientMap.set(clientName, client);
        }
      }

      const results = await Promise.all(Array.from(clientMap.entries()).map(async ([clientName, client]) => {
        try {
          const result = await getNiceHashApp(client).hashpower.getMyOrders(query);
          return (result?.list || []).map(o => ({ ...o, nhClient: clientName }));
        } catch (e) { return []; }
      }));

      data = { list: results.flat() };
    } else {
      data = await req.nhApp.hashpower.getMyOrders(query);
    }

    const rawList = data?.list || data?.myOrders || (Array.isArray(data) ? data : []);
    
    // Process list: hide Account and split Pool details. 
    // Note: removed speed filter to ensure ACTIVE orders with 0 current speed are included.
    const processedList = rawList
      .map(o => ({
        id: o.id || '',
        acceptedCurrentSpeed: o.acceptedCurrentSpeed || 0, // Used by frontend list
        algorithmSpeed: o.acceptedCurrentSpeed || 0,       // Kept for backward compatibility/CSV
        niceAdvertisedHashrate: o.limit || 0,        // Field requested for hashrate tracking
        poolName: o.pool?.name || '',                // Pool Name for identification
        poolHost: o.pool?.stratumHostname || '',     // Split Pool Host
        poolPort: o.pool?.port || '',                // Split Pool Port
        algorithm: typeof o.algorithm === 'object' ? o.algorithm.algorithm : o.algorithm,
        market: typeof o.market === 'object' ? o.market.id : o.market,
        price: o.price,
        limit: o.limit,
        payedAmount: o.payedAmount || 0,             // Required for NiceHashContext summary
        availableAmount: o.availableAmount || 0,     // Required for order details
        rigsCount: o.rigsCount || 0,
        poolUser: o.pool?.username || '',
        poolPass: o.pool?.password || '',
        status: typeof o.status === 'object' ? o.status.code : o.status,
        isDead: (o.status?.code || o.status) === 'ACTIVE' && parseFloat(o.acceptedCurrentSpeed || 0) === 0 && parseInt(o.rigsCount || 0) === 0,
        pool: o.pool,                                // Preserved for UI components (NiceHash.jsx)
        nhClient: o.nhClient,                        // Preserved for aggregation tracking
        ts: new Date().toISOString(),
      }));

    await saveToDatabase('nh_order.csv', processedList.filter(o => o.status === 'ACTIVE'));

    res.json(typeof data === 'object' && !Array.isArray(data) ? { ...data, list: processedList } : processedList);
  }));

  app.get('/api/v2/hashpower/rented-summary', asyncHandler(async (req, res) => {
    const maxPrice = parseFloat(req.query.price);
    if (Number.isNaN(maxPrice)) {
      return res.status(400).json({ error: 'Valid "price" query parameter is required (e.g. ?price=0.007)' });
    }

    const clientParam = String(req.query.client || 'ALL').toUpperCase();
    const nhAccounts = isAggregate(clientParam)
      ? Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && nhConfigs[k].orgId && !isAggregate(k))
      : [clientParam];

    let totalPaid = 0;
    const matchingOrders = [];

    const results = await Promise.all(nhAccounts.map(async (acct) => {
      const { client, clientName } = resolveNhClient(acct);
      if (!client || (acct !== 'BT' && clientName === 'BT' && acct !== 'PH')) return null;
      try {
        const data = await getNiceHashApp(client).hashpower.getMyOrders({ limit: 1000 });
        return { clientName, list: data?.list || [] };
      } catch (e) { return null; }
    }));

    results.filter(Boolean).forEach(({ clientName, list }) => {
      list.forEach(o => {
          const status = typeof o.status === 'object' ? o.status.code : o.status;
          const price = parseFloat(o.price);
          if (status === 'ACTIVE' && price < maxPrice) {
            const paid = parseFloat(o.payedAmount || 0);
            totalPaid += paid;
            matchingOrders.push({ id: o.id, account: clientName, price: o.price, paid: o.payedAmount });
          }
        });
    });

    res.json({ success: true, maxPrice, totalPaid: totalPaid.toFixed(8), count: matchingOrders.length, orders: matchingOrders });
  }));

  app.get('/api/v2/hashpower/order/price', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || 'BT').toUpperCase();
    const query = { ...req.query };
    if (!query.ts) query.ts = Date.now().toString();

    const algorithm = normalizeAlgoForNiceHash(query.algorithm);
    const matchActiveOrder = async (clientName, client) => {
      try {
        const data = await getNiceHashApp(client).hashpower.getMyOrders({ op: 'LE', limit: 100 });
        const rawList = data?.list || data?.myOrders || (Array.isArray(data) ? data : []);
        const activeOrders = rawList.filter(o => String(o?.status?.code || o?.status || '').toUpperCase() === 'ACTIVE');
        const found = activeOrders.find(o => normalizeAlgoForNiceHash(o?.algorithm || o?.algo || o?.type) === algorithm);
        if (!found) return null;
        const price = Number.parseFloat(found.price ?? found.marketPrice ?? found.fixedPrice ?? 0);
        if (!Number.isFinite(price) || price <= 0) return null;
        return {
          fixedPrice: price.toFixed(8),
          speedUnit: getAlgorithmUnit(algorithm),
          price,
          marketPrice: price,
          marketUnit: getAlgorithmUnit(algorithm),
          source: 'active-order',
          nhClient: clientName,
          orderId: found.id,
        };
      } catch {
        return null;
      }
    };

    if (isAggregate(clientParam)) {
      const nhAccounts = Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && nhConfigs[k].orgId && !isAggregate(k));
      for (const acct of nhAccounts) {
        const { client, clientName } = resolveNhClient(acct);
        if (!client || (acct !== 'BT' && clientName === 'BT')) continue;
        try {
          const orderPrice = await matchActiveOrder(clientName, client);
          if (orderPrice) {
            res.set('X-NH-Client', clientName);
            return res.json(orderPrice);
          }
        } catch (e) { }
      }
    }

    if (clientParam !== 'ALL' && clientParam !== 'VN') {
      const { client, clientName } = resolveNhClient(clientParam);
      if (client) {
        const orderPrice = await matchActiveOrder(clientName, client);
        if (orderPrice) {
          res.set('X-NH-Client', clientName);
          return res.json(orderPrice);
        }
      }
    }

    return res.json({
      success: false,
      error: `No active NiceHash order price found for ${algorithm || 'unknown'}.`,
      algorithm: query.algorithm,
      market: query.market || 'USA',
      source: 'active-order',
    });
  }));

  app.get('/api/v2/hashpower/order/:orderId', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || 'BT').toUpperCase();
    if (isAggregate(clientParam)) {
      const nhAccounts = Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && nhConfigs[k].orgId && !isAggregate(k));
      const processedClients = new Set();
      for (const acct of nhAccounts) {
        const { client, clientName } = resolveNhClient(acct);
        if (!client || (acct !== 'BT' && clientName === 'BT') || processedClients.has(clientName)) continue;
        processedClients.add(clientName);
        try {
          const data = await getNiceHashApp(client).hashpower.getOrderDetail(req.params.orderId);
          if (data && !data.error) {
            res.set('X-NH-Client', clientName);
            return res.json(data);
          }
        } catch (e) { }
      }
    }
    res.json(await req.nhApp.hashpower.getOrderDetail(req.params.orderId));
  }));

  app.post('/api/v2/hashpower/order', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.createOrder(req.body))));
  app.get('/api/v2/hashpower/order-book', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.getOrderBook(req.query))));

  app.delete('/api/v2/hashpower/order/:orderId', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.cancelOrder(req.params.orderId))));
  app.post('/api/v2/hashpower/order/:orderId/refill', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.refillOrder(req.params.orderId, req.body))));
  app.post('/api/v2/hashpower/order/:orderId/update', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.updatePriceLimit(req.params.orderId, req.body))));

  app.get('/api/v2/pools', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || 'BT').toUpperCase();
    if (isAggregate(clientParam)) {
      const nhAccounts = Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && nhConfigs[k].orgId && !isAggregate(k));

      const clientMap = new Map();
      for (const acct of nhAccounts) {
        const { client, clientName } = resolveNhClient(acct);
        if (client && !clientMap.has(clientName) && (acct === 'BT' || clientName !== 'BT')) {
          clientMap.set(clientName, client);
        }
      }

      const results = await Promise.all(Array.from(clientMap.entries()).map(async ([clientName, client]) => {
        try {
          const data = await getNiceHashApp(client).pools.getPools();
          const pools = (data?.list || []).map(p => ({ ...p, nhClient: clientName }));
          if (pools.length > 0) {
            db.serialize(() => {
              db.run(`CREATE TABLE IF NOT EXISTS nh_pools (id TEXT, name TEXT, algorithm TEXT, stratumHostname TEXT, port TEXT, username TEXT, password TEXT, nhClient TEXT, last_updated DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, nhClient))`);
              const stmt = db.prepare(`INSERT OR REPLACE INTO nh_pools (id, name, algorithm, stratumHostname, port, username, password, nhClient, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
              pools.forEach(p => stmt.run(p.id, p.name, p.algorithm, p.stratumHostname, p.port, p.username, p.password, clientName));
              stmt.finalize();
            });
          }
          return pools;
        } catch (e) { return []; }
      }));

      return res.json({ list: results.flat(), totalCount: results.flat().length });
    }
    const data = await req.nhApp.pools.getPools();
    const pools = (data?.list || []);
    const clientName = res.get('X-NH-Client') || 'BT';
    if (pools.length > 0) {
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS nh_pools (id TEXT, name TEXT, algorithm TEXT, stratumHostname TEXT, port TEXT, username TEXT, password TEXT, nhClient TEXT, last_updated DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, nhClient))`);
        const stmt = db.prepare(`INSERT OR REPLACE INTO nh_pools (id, name, algorithm, stratumHostname, port, username, password, nhClient, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
        pools.forEach(p => stmt.run(p.id, p.name, p.algorithm, p.stratumHostname, p.port, p.username, p.password, clientName));
        stmt.finalize();
      });
    }
    res.json(data);
  }));

  app.get('/api/v2/pool/:poolId', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || 'BT').toUpperCase();
    if (isAggregate(clientParam)) {
      const nhAccounts = Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && nhConfigs[k].orgId && !isAggregate(k));
      const processedClients = new Set();
      for (const acct of nhAccounts) {
        const { client, clientName } = resolveNhClient(acct);
        if (!client || (acct !== 'BT' && clientName === 'BT') || processedClients.has(clientName)) continue;
        processedClients.add(clientName);
        try {
          const data = await getNiceHashApp(client).pools.getPoolDetails(req.params.poolId);
          if (data && !data.error) {
            res.set('X-NH-Client', clientName);
            return res.json(data);
          }
        } catch (e) { }
      }
    }
    res.json(await req.nhApp.pools.getPoolDetails(req.params.poolId));
  }));
  app.post('/api/v2/pool', asyncHandler(async (req, res) => res.json(await req.nhApp.pools.createPool(req.body))));
  app.post('/api/v2/pools/verify', asyncHandler(async (req, res) => res.json(await req.nhApp.pools.verifyPool(req.body))));

  app.post('/api/v2/pools/verify-browser', asyncHandler(async (req, res) => {
    const { stratumHost, stratumPort, username } = req.body;
    const clientParam = String(req.query.client || 'BT').toUpperCase();
    const isHeadless = req.query.headless === 'true';

    const options = new chrome.Options();
    if (isHeadless) {
      options.addArguments('--headless=new');
    }
    options.addArguments('--window-size=1280,720');

    let driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();

    try {
      await driver.get('https://www.nicehash.com/tools/pool-verification');
      
      const wait = 3000;
      const hostInput = await driver.wait(until.elementLocated(By.css('input[placeholder*="stratum"]')), wait);
      await hostInput.clear();
      await hostInput.sendKeys(`${stratumHost}:${stratumPort}`);
      
      const userInput = await driver.findElement(By.css('input[placeholder*="username"]'));
      await userInput.clear();
      await userInput.sendKeys(username);

      const verifyBtn = await driver.findElement(By.xpath("//button[contains(., 'Verify')]"));
      await verifyBtn.click();

      const resultSection = await driver.wait(until.elementLocated(By.className('verification-results')), 5000);
      const resultText = await resultSection.getText();
      
      const isSuccess = resultText.toLowerCase().includes('success') || resultText.toLowerCase().includes('verified');
      
      res.json({ success: isSuccess, message: resultText, client: clientParam });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    } finally {
      await driver.quit();
    }
  }));

  app.post('/api/v2/mrr/monitor/run', asyncHandler(async (req, res) => {
    const scope = String(req.query.client || req.body?.client || 'ALL').trim().toUpperCase();
    const result = await runRentalMonitor(true, scope);
    res.json({ success: true, ...result });
  }));

  app.post('/api/v2/test/rented-notice', asyncHandler(async (req, res) => {
    const msg = `🚀 <b>[New Rental]</b>\n` +
      `<b>Account:</b> <code>TEST_BT</code>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Rig:</b> Test-Rig-Notice (<code>123456</code>)\n` +
      `<b>Algo:</b> <code>SHA256</code>\n` +
      `<b>Time:</b> 2024-01-01 12:00:00 - 2024-01-02 12:00:00\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Paid:</b> <code>0.00045000 BTC</code>\n` +
      `<b>Efficiency:</b> <b>100.0%</b>\n` +
      `<b>Remaining:</b> 24.00h\n` +
      `<b>Target to 100%:</b> 1.23 TH/s\n` +
      `<i>This is a simulated rental notice.</i>`;

    try {
      const tgRes = await sendTelegramInternal(msg);
      res.json({ success: true, message: 'Test notice sent', telegram: tgRes });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }));

  app.get('/api/v2/mrr/monitor/snapshot', asyncHandler(async (req, res) => {
    db.all(`SELECT * FROM rentals ORDER BY last_updated DESC`, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      saveToDatabase('monitor_snapshot.csv', rows);
      res.json({ success: true, data: rows });
    });
  }));

  app.delete('/api/v2/mrr/monitor/snapshot/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM rentals WHERE id = ?`, [id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    });
  }));

  app.patch('/api/v2/mrr/monitor/snapshot/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const fields = Object.keys(req.body).filter(k => k !== 'id').map(k => `${k} = ?`).join(', ');
    if (!fields) return res.status(400).json({ success: false, error: 'No fields provided for update' });
    const values = [...Object.keys(req.body).filter(k => k !== 'id').map(k => req.body[k]), id];
    db.run(`UPDATE rentals SET ${fields} WHERE id = ?`, values, function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    });
  }));

  app.get('/api/v2/mrr/rigs', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || defaultMrrClient).toUpperCase();
    const targetEndpoint = req.query.endpoint || '/rig/mine';

    if (isAggregate(clientParam)) {
      const allClientNames = Object.keys(mrrConfigs).filter(c => mrrConfigs[c].apiKey && mrrConfigs[c].apiSecret && !isAggregate(c));
      const allRigs = [];

      const results = await Promise.all(allClientNames.map(async (clientName) => {
        try {
          const { data, statusCode } = await mrrApiCall({ endpoint: targetEndpoint, clientNameRaw: clientName });
          const rigs = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.data?.rigs) ? data.data.rigs : []);

          if (targetEndpoint === '/rig/mine' && statusCode === 200 && data.success && rigs.length > 0) {
            const rigIds = rigs.map(r => r.id).join(';');
            const { data: poolsData } = await mrrApiCall({ endpoint: `/rig/${rigIds}/pool`, clientNameRaw: clientName });
            if (poolsData && poolsData.success) {
              const nhPools = await getCachedNhPools(clientName);

              const poolItems = Array.isArray(poolsData.data) ? poolsData.data : (poolsData.data?.result || []);
              const poolMap = new Map(poolItems.map(item => {
                const id = String(item.rigId || item.rigid || item.id || item.rentalid || '');

                if (Array.isArray(item.pools) && item.pools.length > 0) {
                  db.serialize(() => {
                    db.run(`CREATE TABLE IF NOT EXISTS mrr_pools (id TEXT, name TEXT, algo TEXT, host TEXT, port TEXT, user TEXT, mrrClient TEXT, last_updated DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, mrrClient))`);
                    const stmt = db.prepare(`INSERT OR REPLACE INTO mrr_pools (id, name, algo, host, port, user, mrrClient, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
                    item.pools.forEach(p => {
                      const algo = p.algo || p.algorithm || p.type || item.algo || item.algorithm || '';
                      stmt.run(id, p.name || `RigPool-${id}`, algo, p.host || p.stratumHost, p.port || p.stratumPort, p.user || p.username, clientName);
                    });
                    stmt.finalize();
                  });
                }

                if (Array.isArray(item.pools)) {
                  item.pools.forEach(p => {
                    const mrrUser = String(p.user || p.username || '').trim().toLowerCase();
                    const nhMatch = nhPools.find(nhp => String(nhp.username || '').trim().toLowerCase() === mrrUser);
                    if (nhMatch) p.nhPoolName = nhMatch.name;
                  });
                }
                return [id, item.pools];
              }).filter(i => i[0]));

              rigs.forEach(rig => {
                const pools = poolMap.get(String(rig.id));
                if (pools && pools.length > 0) {
                  const p0 = pools.find(p => p.priority === 0 || p.priority === '0') || pools[0];
                  rig.host = p0.host || p0.stratumHost;
                  rig.port = p0.port || p0.stratumPort;
                  rig.user = p0.user || p0.username;
                }
              });
            }
          }

          if (statusCode === 200 && data?.success && rigs.length > 0) {
            return { rigs: rigs.map(rig => ({ ...rig, mrrClient: clientName, nicehashAlgo: normalizeAlgoForNiceHash(rig.algo || rig.type || rig.miningAlgorithm) })) };
          }
          return { error: { client: clientName, message: data?.message || `Failed to fetch rigs (status: ${statusCode})` } };
        } catch (err) {
          return { error: { client: clientName, message: err.message } };
        }
      }));

      const errors = [];
      results.forEach(res => {
        if (res.rigs) allRigs.push(...res.rigs);
        if (res.error) errors.push(res.error);
      });

      await saveToDatabase('mrr_rigs.csv', allRigs);

      res.json({ success: true, rigs: allRigs, errors: errors.length > 0 ? errors : undefined });
    } else {
      if (targetEndpoint === '/rig/mine') {
        const { data, statusCode, clientName } = await mrrApiCall({ endpoint: '/rig/mine', clientNameRaw: clientParam });
        if (statusCode === 200 && data.success) {
          const rigs = Array.isArray(data.data) ? data.data : (data.data?.rigs || []);
          rigs.forEach(rig => { rig.nicehashAlgo = normalizeAlgoForNiceHash(rig.algo || rig.type || rig.miningAlgorithm); });
          if (rigs.length > 0) {
            const rigIds = rigs.map(r => r.id).join(';');
            const { data: poolsData } = await mrrApiCall({ endpoint: `/rig/${rigIds}/pool`, clientNameRaw: clientParam });
            if (poolsData && poolsData.success) {
              const poolItems = Array.isArray(poolsData.data) ? poolsData.data : (poolsData.data?.result || []);
              const poolMap = new Map(poolItems.map(item => [String(item.rigId || item.rigid || item.id), item.pools]));
              rigs.forEach(rig => {
                const pools = poolMap.get(String(rig.id));
                if (pools && pools.length > 0) {
                  const p0 = pools.find(p => p.priority === 0 || p.priority === '0') || pools[0];
                  rig.host = p0.host || p0.stratumHost;
                  rig.port = p0.port || p0.stratumPort;
                  rig.user = p0.user || p0.username;
                }
              });
            }
          }
        }
        res.set('X-MRR-Client', clientName);
        return res.status(statusCode).json(data);
      }
      await mrrRequest(targetEndpoint, req, res);
    }
  }));

  app.get('/api/v2/mrr/rigs/pools', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || defaultMrrClient).toUpperCase();

    if (isAggregate(clientParam)) {
      const allClientNames = Object.keys(mrrConfigs).filter(c => mrrConfigs[c].apiKey && mrrConfigs[c].apiSecret && !isAggregate(c));

      const results = await Promise.all(allClientNames.map(async (clientName) => {
        try {
          const { data: rigsData } = await mrrApiCall({ endpoint: '/rig/mine', clientNameRaw: clientName });
          const rigs = Array.isArray(rigsData?.data) ? rigsData.data : (Array.isArray(rigsData?.data?.rigs) ? rigsData.data.rigs : []);
          if (rigsData?.success && rigs.length > 0) {
            const rigIds = rigs.map(r => r.id).join(';');
            const { data: poolsData } = await mrrApiCall({ endpoint: `/rig/${rigIds}/pool`, clientNameRaw: clientName });
            if (poolsData?.success) {
              const items = (Array.isArray(poolsData.data) ? poolsData.data : [poolsData.data]).map(item => ({
                ...item,
                mrrClient: clientName,
                nicehashAlgo: normalizeAlgoForNiceHash(item.algo || item.algorithm || item.type)
              }));
              return { pools: items.map(item => ({ ...item, mrrClient: clientName })) };
            }
          }
        } catch (err) {
          return { error: { client: clientName, message: err.message } };
        }
        return { pools: [] };
      }));

      const allResults = [];
      const errors = [];
      results.forEach(res => {
        if (res.pools) allResults.push(...res.pools);
        if (res.error) errors.push(res.error);
      });

      res.set('X-MRR-Client', 'ALL');
      return res.json({ success: true, data: allResults, errors: errors.length > 0 ? errors : undefined });
    }

    const { data: rigsData, clientName } = await mrrApiCall({ endpoint: '/rig/mine', clientNameRaw: clientParam });
    const rigs = Array.isArray(rigsData?.data) ? rigsData.data : (Array.isArray(rigsData?.data?.rigs) ? rigsData.data.rigs : []);

    if (!rigsData?.success || rigs.length === 0) {
      res.set('X-MRR-Client', clientName);
      return res.json(rigsData || { success: true, data: [] });
    }

    const rigIds = rigs.map(r => r.id).join(';');
    const { statusCode, data } = await mrrApiCall({ endpoint: `/rig/${rigIds}/pool`, clientNameRaw: clientName });
    res.set('X-MRR-Client', clientName);
    res.status(statusCode).json(data);
  }));

  app.get('/api/v2/mrr/balance', asyncHandler(async (req, res) => mrrRequest('/account/balance', req, res)));
  app.get('/api/v2/mrr/algos', asyncHandler(async (req, res) => {
    const { statusCode, data, clientName } = await mrrApiCall({ endpoint: '/info/algos', clientNameRaw: req.query.client });
    if (statusCode === 200 && data?.success && data.data) {
      const items = Array.isArray(data.data) ? data.data : (data.data.algos || []);
      items.forEach(a => { a.nicehashAlgo = normalizeAlgoForNiceHash(a.algo || a.name || a.slug); });
    }
    res.set('X-MRR-Client', clientName);
    res.status(statusCode).json(data);
  }));
  app.get('/api/v2/mrr/profiles', asyncHandler(async (req, res) => mrrRequest('/profile', req, res)));

  app.get('/api/v2/mrr/account/pool', asyncHandler(async (req, res) => {
    const { client: clientQuery, ...forwardQuery } = req.query || {};
    const targetClient = isAggregate(clientQuery) ? defaultMrrClient : clientQuery;
    const { statusCode, data, clientName } = await mrrApiCall({
      endpoint: '/account/pool',
      method: 'GET',
      clientNameRaw: targetClient,
      query: forwardQuery,
    });
    if (statusCode === 200 && data?.success) {
      await saveToDatabase('mrr_account_pools.csv', data.data || []);

      const pools = data.data || [];
      if (pools.length > 0) {
        db.serialize(() => {
          db.run(`CREATE TABLE IF NOT EXISTS mrr_pools (
            id TEXT, name TEXT, algo TEXT, host TEXT, port TEXT, user TEXT, mrrClient TEXT,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id, mrrClient)
          )`);
          const stmt = db.prepare(`INSERT OR REPLACE INTO mrr_pools (id, name, algo, host, port, user, mrrClient, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
          pools.forEach(p => stmt.run(p.id, p.name, p.algo, p.host, p.port, p.user, clientName));
          stmt.finalize();
        });
      }
    }
    res.set('X-MRR-Client', clientName);
    res.status(statusCode).json(data);
  }));

  app.get('/api/v2/mrr/account/pool/:poolIds', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || defaultMrrClient).toUpperCase();
    const { statusCode, data, clientName } = await mrrApiCall({ endpoint: `/account/pool/${req.params.poolIds}`, clientNameRaw: clientParam });

    if (statusCode === 200 && data?.success) {
      const nhPools = await getCachedNhPools(clientName);

      const items = Array.isArray(data.data) ? data.data : [data.data];
      items.forEach(item => {
        const mrrUser = String(item.user || item.username || '').trim().toLowerCase();
        const nhMatch = nhPools.find(nhp => String(nhp.username || '').trim().toLowerCase() === mrrUser);
        if (nhMatch) item.nhPoolName = nhMatch.name;

        if (Array.isArray(item.pools)) {
          item.pools.forEach(p => {
            const pUser = String(p.user || p.username || '').trim().toLowerCase();
            const pMatch = nhPools.find(nhp => String(nhp.username || '').trim().toLowerCase() === pUser);
            if (pMatch) p.nhPoolName = pMatch.name;
          });
        }
      });
    }
    res.set('X-MRR-Client', clientName);
    res.status(statusCode).json(data);
  }));

  app.post('/api/v2/mrr/account/pool', asyncHandler(async (req, res) => {
    const { client } = req.query;
    const { statusCode, data, clientName } = await mrrApiCall({ endpoint: '/account/pool', method: 'PUT', clientNameRaw: client, body: req.body });
    // MRR returns only {"id": "..."} on creation. We merge the name from the request for UI consistency.
    if (statusCode === 200 && data?.success && data.data?.id && !data.data.name && req.body?.name) {
      data.data.name = req.body.name;
    }
    res.set('X-MRR-Client', clientName);
    res.status(statusCode).json(data);
  }));
  app.put('/api/v2/mrr/account/pool', asyncHandler(async (req, res) => mrrRequest('/account/pool', req, res, 'PUT', req.body)));
  app.put('/api/v2/mrr/account/pool/:poolIds', asyncHandler(async (req, res) => mrrRequest(`/account/pool/${req.params.poolIds}`, req, res, 'PUT', req.body)));
  app.delete('/api/v2/mrr/account/pool/:poolIds', asyncHandler(async (req, res) => mrrRequest(`/account/pool/${req.params.poolIds}`, req, res, 'DELETE')));

  app.get('/api/v2/mrr/compare', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || defaultMrrClient).toUpperCase();
    const algoParam = req.query.algorithm || req.query.algo;

    const { data: mrrData } = await mrrApiCall({ endpoint: '/rig', query: { algo: algoParam }, clientNameRaw: clientParam });
    const rigs = Array.isArray(mrrData?.data?.rigs) ? mrrData.data.rigs : Array.isArray(mrrData?.data) ? mrrData.data : [];
    if (rigs.length === 0) return res.json({ success: true, data: [] });

    const uniqueAlgos = [...new Set(rigs.map(r => String(r.algo || r.type || 'SHA256').toUpperCase()))];
    const { client: nhClient } = resolveNhClient(clientParam);
    const nhApp = getNiceHashApp(nhClient);
    const priceMap = new Map();
    for (const a of uniqueAlgos) {
      try {
        priceMap.set(a, await nhApp.hashpower.getOrderPrice({ algorithm: a, market: 'USA' }));
      } catch (e) { }
    }

    const comparison = rigs.map(r => {
      const a = String(r.algo || r.type || 'SHA256').toUpperCase();
      return {
        mrrRig: {
          id: r.id,
          name: r.name,
          algo: r.algo || r.type,
          nicehashAlgo: normalizeAlgoForNiceHash(r.algo || r.type),
          price: r.price || r.min_price || '0',
          currency: r.price_unit || 'BTC',
          hashrate_unit: r.hashrate_unit || 'TH',
        },
        nicehashPrice: priceMap.get(a) || null
      };
    });

    res.json({ success: true, data: comparison });
  }));

  app.get('/api/v2/mrr/rentals', asyncHandler(async (req, res) => {
    const { client: clientQuery, ...forwardQuery } = req.query || {};
    const result = await fetchAggregatedRentals(forwardQuery, String(clientQuery || defaultMrrClient).toUpperCase());
    
    await saveToDatabase('mrr_rentals.csv', result.data?.data?.rentals || []);

    res.set('X-MRR-Client', result.clientName);
    res.status(result.statusCode).json(result.data);
  }));

  app.get('/api/v2/mrr/rental/history', asyncHandler(async (req, res) => {
    const { client: clientQuery, ...forwardQuery } = req.query || {};
    const result = await fetchAggregatedRentals({ ...forwardQuery, history: '1' }, String(clientQuery || defaultMrrClient).toUpperCase());
    
    await saveToDatabase('mrr_rental_history.csv', result.data?.data?.rentals || []);

    res.set('X-MRR-Client', result.clientName);
    res.status(result.statusCode).json(result.data);
  }));

  app.get('/api/v2/mrr/rig/all', asyncHandler(async (req, res) => mrrRequest('/rig', req, res)));
  app.get('/api/v2/mrr/whoami', asyncHandler(async (req, res) => mrrRequest('/account/whoami', req, res)));
  app.get('/api/v2/mrr/rig', asyncHandler(async (req, res) => mrrRequest('/rig', req, res)));
  app.get('/api/v2/mrr/rig/:rigIds', asyncHandler(async (req, res) => mrrRequest(`/rig/${req.params.rigIds}`, req, res)));

  app.get('/api/v2/mrr/rig/:rigIds/pool', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || defaultMrrClient).toUpperCase();
    const { statusCode, data, clientName } = await mrrApiCall({ endpoint: `/rig/${req.params.rigIds}/pool`, clientNameRaw: clientParam });
    
    if (statusCode === 200 && data?.success) {
      const nhPools = await getCachedNhPools(clientName);

      const items = Array.isArray(data.data) ? data.data : [data.data];
      items.forEach(item => {
        if (Array.isArray(item.pools)) {
          item.pools.forEach(p => {
            const mrrUser = String(p.user || p.username || '').trim().toLowerCase();
            const nhMatch = nhPools.find(nhp => String(nhp.username || '').trim().toLowerCase() === mrrUser);
            if (nhMatch) p.nhPoolName = nhMatch.name;
          });
        }
      });
    }
    res.set('X-MRR-Client', clientName);
    res.status(statusCode).json(data);
  }));

  app.put('/api/v2/mrr/rig/:rigId', asyncHandler(async (req, res) => { await mrrRequest(`/rig/${req.params.rigId}`, req, res, 'PUT', req.body); }));

  app.get('/api/v2/mrr/rental/:rentalIds', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || defaultMrrClient).toUpperCase();
    const rentalId = req.params.rentalIds;

    async function fetchAggressiveRental(clientName) {
      const { statusCode, data } = await mrrApiCall({ endpoint: `/rental/${rentalId}`, clientNameRaw: clientName });
      let rental = data?.data;
      if (statusCode === 200 && data?.success && rental) {
        const initialNorm = extractRentalInfo(rental);
        const hasAlgo = initialNorm.algo !== 'Unknown';
        const hasHash = initialNorm.niceAverageHashrate !== '0 N/A' && initialNorm.niceAverageHashrate !== '0.00 N/A';
        const hasDuration = initialNorm.duration !== '0';
        if (!hasAlgo || !hasHash || !hasDuration) {
          const listRes = await mrrApiCall({ endpoint: '/rental', clientNameRaw: clientName });
          let list = listRes.data?.success ? (Array.isArray(listRes.data.data) ? listRes.data.data : (listRes.data.data?.rentals || [])) : [];
          let found = list.find(r => String(r.id) === String(rentalId));
          if (!found) {
            const histRes = await mrrApiCall({ endpoint: '/rental', query: { history: '1' }, clientNameRaw: clientName });
            list = histRes.data?.success ? (Array.isArray(histRes.data.data) ? histRes.data.data : (histRes.data.data?.rentals || [])) : [];
            found = list.find(r => String(r.id) === String(rentalId));
          }
          if (found) rental = { ...found, ...rental }; 
        }

        const poolRes = await mrrApiCall({ endpoint: `/rental/${rentalId}/pool`, clientNameRaw: clientName });
        if (poolRes.statusCode === 200 && poolRes.data?.success) {
          const pData = poolRes.data.data || poolRes.data;
          rental.pools = Array.isArray(pData.pools) ? pData.pools : (Array.isArray(pData) ? pData : []);
        }

        const normalized = extractRentalInfo(rental);
        const nhAlgo = normalizeAlgoForNiceHash(normalized.algo);
        normalized.nicehashAlgo = nhAlgo;
        if (nhAlgo && nhAlgo !== 'UNKNOWN' && nhAlgo !== 'N/A' && nhAlgo !== '') {
          try {
            const { client: nhClient } = resolveNhClient(clientParam);
            rental.nicehashPrice = await getNiceHashApp(nhClient).hashpower.getOrderPrice({ algorithm: nhAlgo, market: 1 });
          } catch (e) { }
        }

        if (data.data) data.data = { ...rental, normalized };
        else Object.assign(data, { ...rental, normalized });
      }
      return { statusCode, data };
    }

    if (isAggregate(clientParam)) {
      const clients = Object.keys(mrrConfigs).filter(c => mrrConfigs[c].apiKey && mrrConfigs[c].apiSecret && !isAggregate(c));
      const candidates = await Promise.all(clients.map(async (clientName) => {
        const res = await fetchAggressiveRental(clientName);
        return { clientName, ...res };
      }));
      const found = candidates.find(c => c.statusCode === 200 && c.data?.success);
      if (found) {
        res.set('X-MRR-Client', found.clientName);
        return res.json(found.data);
      }
      return res.status(404).json({ success: false, message: 'Rental ID not found in any configured account.' });
    }

    const { statusCode, data } = await fetchAggressiveRental(clientParam);
    res.status(statusCode).json(data);
  }));

  app.get('/api/v2/mrr/rental/:rentalIds/pool', asyncHandler(async (req, res) => mrrRequest(`/rental/${req.params.rentalIds}/pool`, req, res)));
  app.get('/api/v2/mrr/rental/:rentalId/hashrate', asyncHandler(async (req, res) => { await mrrRequest(`/rental/${req.params.rentalId}/hashrate`, req, res); }));
  app.put('/api/v2/mrr/rig/:rigId/pool', asyncHandler(async (req, res) => { await mrrRequest(`/rig/${req.params.rigId}/pool`, req, res, 'PUT', req.body); }));

  app.get('/api/v2/mrr/rig/:rigIds/info', asyncHandler(async (req, res) => {
    const ids = req.params.rigIds.split(';').map(id => id.trim()).filter(Boolean);
    if (ids.length === 0) return res.status(400).json({ success: false, message: 'No Rig IDs provided' });

    const fetchSingleInfo = async (id) => {
      try {
        const poolRes = await mrrApiCall({ endpoint: `/rig/${id}/pool`, clientNameRaw: req.query.client });
        let info = extractRigInfo(poolRes.data);
        if (!info.miningAlgorithm || !info.stratumHost || !info.username || !info.password || !info.stratumPort) {
          const rigRes = await mrrApiCall({ endpoint: `/rig/${id}`, clientNameRaw: req.query.client });
          info = extractRigInfo(rigRes.data);
        }
        const nhAlgo = normalizeAlgoForNiceHash(info.miningAlgorithm);
        info.nicehashAlgo = nhAlgo;
        if (nhAlgo && nhAlgo !== 'N/A' && nhAlgo !== '' && nhAlgo !== 'UNKNOWN') {
          try {
            const { client: nhClient } = resolveNhClient(req.query.client);
            info.nicehashPrice = await getNiceHashApp(nhClient).hashpower.getOrderPrice({ algorithm: nhAlgo, market: 1 });
          } catch (e) { }
        }
        return { rigId: id, success: true, ...info };
      } catch (err) {
        return { rigId: id, success: false, message: err.message };
      }
    };

    if (ids.length === 1) {
      const result = await fetchSingleInfo(ids[0]);
      res.set('X-MRR-Client', String(req.query.client || defaultMrrClient).toUpperCase());
      return res.json(result);
    }

    const results = await Promise.all(ids.map(id => fetchSingleInfo(id)));
    
    res.set('X-MRR-Client', String(req.query.client || defaultMrrClient).toUpperCase());
    res.json({ success: true, data: results });
  }));

  app.post('/api/v2/mrr/call', asyncHandler(async (req, res) => {
    const {
      endpoint,
      method = 'GET',
      client,
      query,
      body,
    } = req.body || {};

    const { statusCode, data, clientName } = await mrrApiCall({
      endpoint,
      method,
      clientNameRaw: client || req.query.client,
      query: query && typeof query === 'object' ? query : undefined,
      body,
    });

    res.set('X-MRR-Client', clientName);
    res.status(statusCode).json(data);
  }));

  app.post('/api/v2/notify/telegram', asyncHandler(async (req, res) => {
    const { message } = req.body;
    try {
      const data = await sendTelegramInternal(message);
      res.json(data);
    } catch (err) {
      console.warn(`[telegram] ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  }));

  app.get('/api/v2/notify/telegram/status', asyncHandler(async (req, res) => {
    res.json(await getTelegramStatus());
  }));

  app.post('/api/v2/notify/telegram/status', asyncHandler(async (req, res) => {
    const { enabled } = req.body;
    res.json(await setTelegramStatus(enabled));
  }));

  app.get('/api/v2/notify/telegram/health', asyncHandler(async (req, res) => {
    const hasToken = !!process.env.TELEGRAM_BOT_TOKEN;
    const hasChatId = !!process.env.TELEGRAM_CHAT_ID;
    res.json({
      success: hasToken && hasChatId,
      configured: hasToken && hasChatId,
      tokenPresent: hasToken,
      chatIdPresent: hasChatId,
    });
  }));

  app.get('/api/v2/extracted-pools', asyncHandler(async (req, res) => {
    const filePath = path.resolve(process.cwd(), 'extracted_pools.json');
    try {
      await fs.access(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content || '[]');
      res.json(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.json([]);
      }
      res.status(500).json({ success: false, error: `Error reading extracted pools: ${err.message}` });
    }
  }));

  app.post('/api/v2/mining/training-snapshot', asyncHandler(async (req, res) => {
    try {
      const result = await saveMiningTrainingSnapshot(req.body || {});
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[mining-training] Failed to save snapshot:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }));

  /**
   * Fetches current market prices for popular mining-related coins from CoinGecko.
   * Implements caching and fallback rates to ensure reliability even when API is rate-limited.
   */
  app.get('/api/v2/mining/opportunities/scan', asyncHandler(handleMiningOpportunityScan));

  app.get('/api/v2/prices/coingecko', asyncHandler(async (req, res) => {
    const defaultIds = 'bitcoin,ethereum,ethereum-classic,litecoin,ravencoin,monero,kaspa,iron-fish,zephyr-protocol,clore-ai,dynex,conflux,ergo';
    const ids = req.query.ids || defaultIds;
    const cacheKey = `coingecko:${ids}`;

    // Check in-memory cache first
    const cached = coinGeckoCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
      return res.json({ success: true, data: cached.data, cached: true });
    }

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,btc&include_24hr_change=true`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.status?.error_message || `CoinGecko API failure (HTTP ${response.status})`;

        // Use fallback rates on any API failure
        const fallback = buildFallbackPrices(ids);
        coinGeckoCache.set(cacheKey, { data: fallback, expires: Date.now() + COINGECKO_CACHE_TTL });
        console.warn(`[CoinGecko] ${errorMsg} - using fallback rates`);
        return res.json({ success: true, data: fallback, fallback: true });
      }

      const data = await response.json();

      // Fill in any missing coins with fallback rates
      const coins = ids.split(',').map(s => s.trim());
      for (const coin of coins) {
        if (!data[coin]) {
          const fallbackRate = FALLBACK_BTC_RATES[coin];
          if (fallbackRate !== undefined) {
            data[coin] = { usd: 0, btc: fallbackRate };
          }
        }
        // Ensure `bitcoin` always has btc:1
        if (coin === 'bitcoin' && data[coin]) {
          data[coin].btc = 1;
        }
      }

      coinGeckoCache.set(cacheKey, { data, expires: Date.now() + COINGECKO_CACHE_TTL });
      res.json({ success: true, data });
    } catch (err) {
      // Network error - use fallback rates
      const fallback = buildFallbackPrices(ids);
      coinGeckoCache.set(cacheKey, { data: fallback, expires: Date.now() + COINGECKO_CACHE_TTL });
      console.warn(`[CoinGecko] Network error: ${err.message} - using fallback rates`);
      res.json({ success: true, data: fallback, fallback: true });
    }
  }));
}
