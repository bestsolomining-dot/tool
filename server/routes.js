import fs from 'fs/promises';
import path from 'path';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { asyncHandler, maskSensitive, extractAlgorithmItems, extractRentalInfo, extractRigInfo } from './utils.js';
import { mrrApiCall, mrrRequest, fetchAggregatedRentals, mrrConfigs, defaultMrrClient } from './mrr.js';
import { resolveNhClient, getNiceHashApp, nhConfigs, isAggregate, normalizeAlgoForNiceHash, mapNiceHashToMRR } from './nh.js';
import { sendTelegramInternal, runRentalMonitor, getTelegramStatus, setTelegramStatus } from './monitor.js';
import { db } from './db.js';

export function registerRoutes(app) {
  app.use('/api/v2', (req, res, next) => {
    if (req.path.startsWith('/mrr/') || req.path === '/algos/mapping') return next();
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
      const nhAccounts = Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret);
      const results = [];
      const processedClients = new Set();
      for (const acct of nhAccounts) {
        const { client, clientName } = resolveNhClient(acct);
        if (!client || (acct !== 'BT' && clientName === 'BT') || processedClients.has(clientName)) continue;
        processedClients.add(clientName);
        try {
          const data = await getNiceHashApp(client).accounting.getBalances();
          if (data) results.push({ client: clientName, data });
        } catch (e) { }
      }

      if (results.length === 0) return res.json({ currencies: [], total: { available: '0', pending: '0', totalBalance: '0', currency: 'BTC' } });

      const total = { available: 0, pending: 0, totalBalance: 0, currency: 'BTC' };
      const allCurrencies = [];
      results.forEach(r => {
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
      const nhAccounts = Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && !isAggregate(k));
      const allRigs = [];
      const processedClients = new Set();
      for (const acct of nhAccounts) {
        const { client, clientName } = resolveNhClient(acct);
        if (!client || (acct !== 'BT' && clientName === 'BT') || processedClients.has(clientName)) continue;
        processedClients.add(clientName);
        try {
          const data = await getNiceHashApp(client).mining.getRigs();
          if (data?.miningRigs) {
            allRigs.push(...data.miningRigs.map(r => ({ ...r, nhClient: clientName })));
          }
        } catch (e) { }
      }
      return res.json({ miningRigs: allRigs });
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
      const nhAccounts = Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && !isAggregate(k));
      const allOrders = [];
      const processedClients = new Set();
      for (const acct of nhAccounts) {
        const { client, clientName } = resolveNhClient(acct);
        if (!client || (acct !== 'BT' && clientName === 'BT') || processedClients.has(clientName)) continue;
        processedClients.add(clientName);
        try {
          const result = await getNiceHashApp(client).hashpower.getMyOrders(query);
          if (result?.list) {
            allOrders.push(...result.list.map(o => ({ ...o, nhClient: clientName })));
          }
        } catch (e) { }
      }
      data = { list: allOrders };
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
        poolHost: o.pool?.stratumHostname || '',     // Split Pool Host
        poolPort: o.pool?.port || '',                // Split Pool Port
        algorithm: typeof o.algorithm === 'object' ? o.algorithm.algorithm : o.algorithm,
        market: typeof o.market === 'object' ? o.market.id : o.market,
        price: o.price,
        limit: o.limit,
        payedAmount: o.payedAmount || 0,             // Required for RentedRigContext summary
        availableAmount: o.availableAmount || 0,     // Required for order details
        rigsCount: o.rigsCount || 0,
        poolUser: o.pool?.username || '',
        poolPass: o.pool?.password || '',
        status: typeof o.status === 'object' ? o.status.code : o.status,
        pool: o.pool,                                // Preserved for UI components (NiceHash.jsx)
        nhClient: o.nhClient,                        // Preserved for aggregation tracking
        ts: new Date().toISOString(),
      }));

    if (processedList.length > 0) {
      try {
        const headers = Object.keys(processedList[0]).join(',');
        const rows = processedList.map(row =>
          Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        const csvContent = `${headers}\n${rows}`;
        const filePath = path.join(process.cwd(), 'orders.csv');
        await fs.writeFile(filePath, csvContent, 'utf-8');
      } catch (csvErr) {
        console.error('[export] Failed to save orders:', csvErr.message);
      }
    }

    res.json(typeof data === 'object' && !Array.isArray(data) ? { ...data, list: processedList } : processedList);
  }));

  app.get('/api/v2/hashpower/rented-summary', asyncHandler(async (req, res) => {
    const maxPrice = parseFloat(req.query.price);
    if (Number.isNaN(maxPrice)) {
      return res.status(400).json({ error: 'Valid "price" query parameter is required (e.g. ?price=0.007)' });
    }

    const clientParam = String(req.query.client || 'ALL').toUpperCase();
    const nhAccounts = isAggregate(clientParam)
      ? Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && !isAggregate(k))
      : [clientParam];

    let totalPaid = 0;
    const matchingOrders = [];

    for (const acct of nhAccounts) {
      const { client, clientName } = resolveNhClient(acct);
      if (!client || (acct !== 'BT' && clientName === 'BT' && acct !== 'LN')) continue;
      try {
        const result = await getNiceHashApp(client).hashpower.getMyOrders({ limit: 1000 });
        const list = result?.list || [];
        list.forEach(o => {
          const status = typeof o.status === 'object' ? o.status.code : o.status;
          const price = parseFloat(o.price);
          if (status === 'ACTIVE' && price < maxPrice) {
            const paid = parseFloat(o.payedAmount || 0);
            totalPaid += paid;
            matchingOrders.push({ id: o.id, account: clientName, price: o.price, paid: o.payedAmount });
          }
        });
      } catch (e) { }
    }

    res.json({ success: true, maxPrice, totalPaid: totalPaid.toFixed(8), count: matchingOrders.length, orders: matchingOrders });
  }));

  app.get('/api/v2/hashpower/order/:orderId', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || 'BT').toUpperCase();
    if (isAggregate(clientParam)) {
      const nhAccounts = Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && !isAggregate(k));
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
  
  // Sanitize query to remove tool-specific params (client, ts) before sending to NiceHash
  app.get('/api/v2/hashpower/order/price', asyncHandler(async (req, res) => {
    const { algorithm } = req.query;
    const market = ['USA', 'EU'].includes(String(req.query.market).toUpperCase()) ? req.query.market.toUpperCase() : 'USA';
    res.json(await req.nhApp.hashpower.getOrderPrice({ algorithm, market }));
  }));

  // FIX: Resolved 405 error. Using getOrderPrice for both standard and business 
  // as they share the /order/calculate GET endpoint for price data.
  app.get('/api/v2/hashpower/business/order', asyncHandler(async (req, res) => {
    const { algorithm } = req.query;
    const market = ['USA', 'EU'].includes(String(req.query.market).toUpperCase()) ? req.query.market.toUpperCase() : 'USA';
    res.json(await req.nhApp.hashpower.getOrderPrice({ algorithm, market }));
  }));

  app.delete('/api/v2/hashpower/order/:orderId', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.cancelOrder(req.params.orderId))));
  app.post('/api/v2/hashpower/order/:orderId/refill', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.refillOrder(req.params.orderId, req.body))));
  app.post('/api/v2/hashpower/order/:orderId/update', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.updatePriceLimit(req.params.orderId, req.body))));

  app.get('/api/v2/pools', asyncHandler(async (req, res) => {
    const clientParam = String(req.query.client || 'BT').toUpperCase();
    if (isAggregate(clientParam)) {
      const allPools = [];
      const nhAccounts = Object.keys(nhConfigs).filter(k => nhConfigs[k].apiKey && nhConfigs[k].apiSecret && !isAggregate(k));
      const processedClients = new Set();
      for (const acct of nhAccounts) {
        const { client, clientName } = resolveNhClient(acct);
        if (!client || (acct !== 'BT' && clientName === 'BT') || processedClients.has(clientName)) continue;
        processedClients.add(clientName);
        try {
          const result = await getNiceHashApp(client).pools.getPools();
          if (result?.list) {
            allPools.push(...result.list.map(p => ({ ...p, nhClient: clientName })));
          }
        } catch (e) { }
      }
      return res.json({ list: allPools, totalCount: allPools.length });
    }
    res.json(await req.nhApp.pools.getPools());
  }));

  app.get('/api/v2/pool/:poolId', asyncHandler(async (req, res) => res.json(await req.nhApp.pools.getPoolDetails(req.params.poolId))));
  app.post('/api/v2/pool', asyncHandler(async (req, res) => res.json(await req.nhApp.pools.createPool(req.body))));
  app.post('/api/v2/pools/verify', asyncHandler(async (req, res) => res.json(await req.nhApp.pools.verifyPool(req.body))));

  // Route verify bằng Chromedriver tự động load thông tin từ account
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
      // Sử dụng công cụ public của NiceHash để verify nhanh không cần login
      await driver.get('https://www.nicehash.com/tools/pool-verification');
      
      const wait = 15000;
      // Điền thông tin Host:Port
      const hostInput = await driver.wait(until.elementLocated(By.css('input[placeholder*="stratum"]')), wait);
      await hostInput.clear();
      await hostInput.sendKeys(`${stratumHost}:${stratumPort}`);
      
      // Điền Username
      const userInput = await driver.findElement(By.css('input[placeholder*="username"]'));
      await userInput.clear();
      await userInput.sendKeys(username);

      // Click Verify
      const verifyBtn = await driver.findElement(By.xpath("//button[contains(., 'Verify')]"));
      await verifyBtn.click();

      // Đợi kết quả hiển thị trên UI của trình duyệt
      const resultSection = await driver.wait(until.elementLocated(By.className('verification-results')), 30000);
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
              const poolItems = Array.isArray(poolsData.data) ? poolsData.data : (poolsData.data?.result || []);
              const poolMap = new Map(poolItems.map(item => {
                const id = String(item.rigId || item.rigid || item.id || item.rentalid || '');
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
            return { rigs: rigs.map(rig => ({ ...rig, mrrClient: clientName })) };
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

      res.json({ success: true, rigs: allRigs, errors: errors.length > 0 ? errors : undefined });
    } else {
      if (targetEndpoint === '/rig/mine') {
        const { data, statusCode, clientName } = await mrrApiCall({ endpoint: '/rig/mine', clientNameRaw: clientParam });
        if (statusCode === 200 && data.success) {
          const rigs = Array.isArray(data.data) ? data.data : (data.data?.rigs || []);
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
      const allResults = [];
      const errors = [];

      for (const clientName of allClientNames) {
        try {
          const { data: rigsData } = await mrrApiCall({ endpoint: '/rig/mine', clientNameRaw: clientName });
          const rigs = Array.isArray(rigsData?.data) ? rigsData.data : (Array.isArray(rigsData?.data?.rigs) ? rigsData.data.rigs : []);

          if (rigsData?.success && rigs.length > 0) {
            const rigIds = rigs.map(r => r.id).join(';');
            const { data: poolsData } = await mrrApiCall({ endpoint: `/rig/${rigIds}/pool`, clientNameRaw: clientName });
            if (poolsData?.success) {
              const items = Array.isArray(poolsData.data) ? poolsData.data : [poolsData.data];
              allResults.push(...items.map(item => ({ ...item, mrrClient: clientName })));
            }
          }
        } catch (err) {
          errors.push({ client: clientName, message: err.message });
        }
      }
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
  app.get('/api/v2/mrr/algos', asyncHandler(async (req, res) => mrrRequest('/info/algos', req, res)));
  app.get('/api/v2/mrr/profiles', asyncHandler(async (req, res) => mrrRequest('/profile', req, res)));

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
    res.set('X-MRR-Client', result.clientName);
    res.status(result.statusCode).json(result.data);
  }));

  app.get('/api/v2/mrr/rental/history', asyncHandler(async (req, res) => {
    const { client: clientQuery, ...forwardQuery } = req.query || {};
    const result = await fetchAggregatedRentals({ ...forwardQuery, history: '1' }, String(clientQuery || defaultMrrClient).toUpperCase());
    res.set('X-MRR-Client', result.clientName);
    res.status(result.statusCode).json(result.data);
  }));

  app.get('/api/v2/mrr/rig/all', asyncHandler(async (req, res) => mrrRequest('/rig', req, res)));
  app.get('/api/v2/mrr/whoami', asyncHandler(async (req, res) => mrrRequest('/account/whoami', req, res)));
  app.get('/api/v2/mrr/rig', asyncHandler(async (req, res) => mrrRequest('/rig', req, res)));
  app.get('/api/v2/mrr/rig/:rigIds', asyncHandler(async (req, res) => mrrRequest(`/rig/${req.params.rigIds}`, req, res)));
  app.get('/api/v2/mrr/rig/:rigIds/pool', asyncHandler(async (req, res) => mrrRequest(`/rig/${req.params.rigIds}/pool`, req, res)));

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
        if (nhAlgo && nhAlgo !== 'UNKNOWN' && nhAlgo !== 'N/A' && nhAlgo !== '') {
          try {
            const { client: nhClient } = resolveNhClient(clientParam);
            rental.nicehashPrice = await getNiceHashApp(nhClient).hashpower.getOrderPrice({ algorithm: nhAlgo, market: 'USA' });
          } catch (e) { }
        }

        if (data.data) data.data = { ...rental, normalized };
        else Object.assign(data, { ...rental, normalized });
      }
      return { statusCode, data };
    }

    if (isAggregate(clientParam)) {
      const clients = Object.keys(mrrConfigs).filter(c => mrrConfigs[c].apiKey && mrrConfigs[c].apiSecret && !isAggregate(c));
      for (const clientName of clients) {
        const { statusCode, data } = await fetchAggressiveRental(clientName);
        if (statusCode === 200 && data?.success) {
          res.set('X-MRR-Client', clientName);
          return res.json(data);
        }
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
        if (nhAlgo && nhAlgo !== 'N/A' && nhAlgo !== '' && nhAlgo !== 'UNKNOWN') {
          try {
            const { client: nhClient } = resolveNhClient(req.query.client);
            info.nicehashPrice = await getNiceHashApp(nhClient).hashpower.getOrderPrice({ algorithm: nhAlgo, market: 'USA' });
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

    const results = await Promise.all(ids.map(fetchSingleInfo));
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
}
