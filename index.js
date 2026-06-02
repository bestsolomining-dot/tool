import 'dotenv/config';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { createHash, createHmac } from 'crypto';
import { request } from 'undici';
import { NiceHashClient } from './NiceHashClient.js';

const app = express();
app.set('etag', false); // Disable ETags to prevent 304 caching on API errors
app.use(express.json());

// --- CORS MIDDLEWARE (Must be first) ---
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  // Explicitly expose custom headers so the browser allows the frontend to read them
  res.setHeader('Access-Control-Expose-Headers', 'X-MRR-Client, Retry-After, X-RateLimit-Limit');
  
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- AUTHENTICATION ---
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const securePassword = process.env.APP_PASSWORD || 'admin123';
  if (password === securePassword) {
    return res.json({ success: true, token: 'session_' + Math.random().toString(36).slice(2) });
  }
  res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/update-config', asyncHandler(async (req, res) => {
  const { config } = req.body;
  if (!config || typeof config !== 'object') {
    return res.status(400).json({ error: 'Invalid configuration data' });
  }

  let envContent = '';
  for (const [key, value] of Object.entries(config)) {
    envContent += `${key}="${String(value).replace(/"/g, '\\"')}"\n`;
  }

  await fs.writeFile(path.join(process.cwd(), '.env'), envContent, 'utf-8');
  res.json({ success: true, message: 'Configuration saved. App will restart.' });
}));

app.get('/api/config-status', (req, res) => {
  res.json({
    nicehash: !!(process.env.NICEHASH_API_KEY && process.env.NICEHASH_API_SECRET),
    envLoaded: true
  });
});

const SENSITIVE_KEYS = new Set(['password', 'apiKey', 'apiSecret', 'secret', 'token']);

function maskSensitive(value) {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.has(key) ? '<masked>' : maskSensitive(item),
    ]),
  );
}

app.use((req, res, next) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).slice(2, 8);
  const body = req.method === 'GET' ? '' : ` body=${JSON.stringify(maskSensitive(req.body || {}))}`;

  console.info(`[api:${requestId}] -> ${req.method} ${req.originalUrl}${body}`);

  res.on('finish', () => {
    console.info(`[api:${requestId}] <- ${res.statusCode} ${req.method} ${req.originalUrl} ${Date.now() - start}ms`);
  });

  next();
});

/**
 * NiceHashApp organizes API calls into logical domains.
 */
let nhInstance = null;

function resolveNhClient() {
  if (nhInstance) return nhInstance;

  const apiKey = normalizeCredential(process.env.NICEHASH_API_KEY);
  const apiSecret = normalizeCredential(process.env.NICEHASH_API_SECRET);
  const orgId = normalizeCredential(process.env.NICEHASH_ORG_ID);

  if (!apiKey || !apiSecret || !orgId) {
    const err = new Error(`NiceHash credentials missing.`);
    err.statusCode = 400;
    throw err;
  }

  nhInstance = new NiceHashClient({
    apiKey, apiSecret, orgId,
    environment: normalizeCredential(process.env.NICEHASH_ENVIRONMENT) || 'production'
  });
  return nhInstance;
}
const NiceHashApp = {
  // --- PUBLIC DATA ---
  public: {
    getTime: (nh) => nh.getServerTime(),
    getDoc: (nh) => nh.call({ method: 'GET', path: '/api/v2/doc' }),
    getAlgorithms: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/algorithms' }),
    getMarkets: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/markets' }),
    getCurrencies: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/public/currencies' }),
    getNetworks: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/public/networks' }),
    getFeeInfo: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/public/service/fee/info' }),
    getCountries: (nh) => nh.call({ method: 'GET', path: '/api/v2/enum/countries' }),
    getOrgIndustry: (nh) => nh.call({ method: 'GET', path: '/api/v2/enum/organisationIndustry' }),
    getPermissions: (nh) => nh.call({ method: 'GET', path: '/api/v2/enum/permissions' }),
    getXchCountries: (nh) => nh.call({ method: 'GET', path: '/api/v2/enum/xchCountries' }),
    getSystemFlags: (nh) => nh.call({ method: 'GET', path: '/api/v2/system/flags' }),
  },

  // --- ACCOUNTING & WALLET ---
  accounting: {
    getBalances: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/accounting/accounts2', query: { ts: Date.now().toString() } }),
    getBalance: (nh, currency) => nh.call({ method: 'GET', path: `/main/api/v2/accounting/account2/${currency}`, query: { ts: Date.now().toString() } }),
    getActivitiesAll: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/accounting/activities', query: { ts: Date.now().toString() } }),
    getActivity: (nh, currency) => nh.call({ method: 'GET', path: `/main/api/v2/accounting/activity/${currency}`, query: { ts: Date.now().toString() } }),
    getCurrencies: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/accounting/currencies', query: { ts: Date.now().toString() } }),
    getDepositAddressLn: (nh, body) => nh.call({ method: 'POST', path: '/main/api/v2/accounting/depositAddress/ln', body }),
    getDepositAddresses: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/accounting/depositAddresses', query: { ts: Date.now().toString() } }),
    getDepositsAll: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/accounting/deposits', query: { ts: Date.now().toString() } }),
    getDeposits: (nh, currency) => nh.call({ method: 'GET', path: `/main/api/v2/accounting/deposits/${currency}`, query: { ts: Date.now().toString() } }),
    getDepositDetail: (nh, currency, id) => nh.call({ method: 'GET', path: `/main/api/v2/accounting/deposits2/${currency}/${id}`, query: { ts: Date.now().toString() } }),
    getExchangeTrades: (nh, id) => nh.call({ method: 'GET', path: `/main/api/v2/accounting/exchange/${id}/trades`, query: { ts: Date.now().toString() } }),
    getHashpowerTransactions: (nh, id) => nh.call({ method: 'GET', path: `/main/api/v2/accounting/hashpower/${id}/transactions`, query: { ts: Date.now().toString() } }),
    getMiningEarnings: (nh, currency) => nh.call({ method: 'GET', path: `/main/api/v2/accounting/hashpowerEarnings/${currency}`, query: { ts: Date.now().toString() } }),
    getIndividualBalance: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/accounting/individual/balance', query: { ts: Date.now().toString() } }),
    listVirginUtxos: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/accounting/list/virginUtxo', query: { ts: Date.now().toString() } }),
    selectVirginUtxo: (nh, body) => nh.call({ method: 'POST', path: '/main/api/v2/accounting/select/virginUtxo', body }),
    getTransaction: (nh, currency, transactionId) => nh.call({ method: 'GET', path: `/main/api/v2/accounting/transaction/${currency}/${transactionId}`, query: { ts: Date.now().toString() } }),
    getTransactions: (nh, currency) => nh.call({ method: 'GET', path: `/main/api/v2/accounting/transactions/${currency}`, query: { ts: Date.now().toString() } }),
    transitionConsolidation: (nh, body) => nh.call({ method: 'POST', path: '/main/api/v2/accounting/transition/consolidation', body }),
    getTravelRuleData: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/accounting/travelrule/transaction/data', query: { ts: Date.now().toString() } }),
    getTravelRuleVasps: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/accounting/travelrule/vasps', query: { ts: Date.now().toString() } }),
    resolveWithheld: (nh, id) => nh.call({ method: 'POST', path: `/main/api/v2/accounting/travelrule/withheldDeposit/resolve/${id}` }),
    createWithdrawal: (nh, body) => nh.call({ method: 'POST', path: '/main/api/v2/accounting/withdrawal', body }),
    cancelWithdrawal: (nh, currency, id) => nh.call({ method: 'DELETE', path: `/main/api/v2/accounting/withdrawal/${currency}/${id}` }),
    getWithdrawalDetail: (nh, currency, id) => nh.call({ method: 'GET', path: `/main/api/v2/accounting/withdrawal2/${currency}/${id}`, query: { ts: Date.now().toString() } }),
    getWithdrawalAddress: (nh, id) => nh.call({ method: 'GET', path: `/main/api/v2/accounting/withdrawalAddress/${id}`, query: { ts: Date.now().toString() } }),
    getWithdrawalAddresses: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/accounting/withdrawalAddresses', query: { ts: Date.now().toString() } }),
    getWithdrawals: (nh, currency) => nh.call({ method: 'GET', path: `/main/api/v2/accounting/withdrawals/${currency}`, query: { ts: Date.now().toString() } }),
  },

  // --- RIG MANAGEMENT (MINER PRIVATE) ---
  mining: {
    getMiningAddress: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/miningAddress', query: { ts: Date.now().toString() } }),
    getAlgoStats: (nh, query) => nh.call({ method: 'GET', path: '/main/api/v2/mining/algo/stats', query: { ts: Date.now().toString(), ...query } }),
    getGroups: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/groups/list', query: { ts: Date.now().toString() } }),
    getRigStatsAlgo: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/rig/stats/algo', query: { ts: Date.now().toString() } }),
    getRigStatsUnpaid: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/rig/stats/unpaid', query: { ts: Date.now().toString() } }),
    getRigDetails: (nh, rigId) => nh.call({ method: 'GET', path: `/main/api/v2/mining/rig2/${rigId}`, query: { ts: Date.now().toString() } }),
    getRigsLegacy: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/rigs', query: { ts: Date.now().toString() } }),
    getActiveWorkers: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/rigs/activeWorkers', query: { ts: Date.now().toString() } }),
    getPayouts: (nh, query) => nh.call({ method: 'GET', path: '/main/api/v2/mining/rigs/payouts', query: { ts: Date.now().toString(), ...query } }),
    getRigsStatsAlgo: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/algo', query: { ts: Date.now().toString() } }),
    getRigsStatsData: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/data', query: { ts: Date.now().toString() } }),
    getRigsStatsDataAlgo: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/data/algo', query: { ts: Date.now().toString() } }),
    getRigsStatsHistory: (nh, query) => nh.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/history', query }),
    getRigsStatsUnpaid: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/unpaid', query: { ts: Date.now().toString() } }),
    setRigStatus: (nh, body) => nh.call({ method: 'POST', path: '/main/api/v2/mining/rigs/status2', body }),
    getRigs: (nh, query) => nh.call({ method: 'GET', path: '/main/api/v2/mining/rigs2', query: { ts: Date.now().toString(), ...query } }),
    exportOfflineRigs: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/rigs2/exportOffline', query: { ts: Date.now().toString() } }),
  },

  // --- HASHPOWER MARKETPLACE ---
  hashpower: {
    getBusinessBuyerStats: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/hashpower/business/buyer/stats' }),
    getBusinessBuyerInfo: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/hashpower/business/buyers/info' }),
    getMyOrders: (nh, query) => nh.call({ method: 'GET', path: '/main/api/v2/hashpower/myOrders', query: { orgId: nh.orgId, ...query } }),
    createOrder: (nh, orderData) => nh.call({ method: 'POST', path: '/main/api/v2/hashpower/order', body: orderData }),
    getOrderDetail: (nh, orderId) => nh.call({ method: 'GET', path: `/main/api/v2/hashpower/order/${orderId}`, query: { ts: Date.now().toString() } }),
    cancelOrder: (nh, orderId) => nh.call({ method: 'DELETE', path: `/main/api/v2/hashpower/order/${orderId}` }),
    refillOrder: (nh, orderId, body) => nh.call({ method: 'POST', path: `/main/api/v2/hashpower/order/${orderId}/refill`, body }),
    updatePriceLimit: (nh, orderId, body) => nh.call({ method: 'POST', path: `/main/api/v2/hashpower/order/${orderId}/updatePriceAndLimit`, body }),
    getVmmOrders: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/hashpower/vmm/orders', query: { ts: Date.now().toString() } }),
    // Public Hashpower
    getOrderPrice: (nh, query) => nh.call({ method: 'GET', path: '/main/api/v2/hashpower/order/price', query }),
    getOrderBook: (nh, query) => nh.call({ method: 'GET', path: '/main/api/v2/hashpower/orderBook', query: { ts: Date.now().toString(), ...query } }),
    getGlobalStats24h: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/public/stats/global/24h' }),
  },

  // --- EASYMINING ---
  easyMining: {
    getMassBuyConfigs: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/hashpower/easymining/massbuy/configurations', query: { ts: Date.now().toString() } }),
    getSoloOrders: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/hashpower/solo/order', query: { ts: Date.now().toString() } }),
    buySoloPackage: (nh, body) => nh.call({ method: 'POST', path: '/main/api/v2/hashpower/solo/order', body }),
    // Public EasyMining
    getCurrencyAlgos: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/public/currency-algos' }),
    getPackages: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/public/easymining/packages' }),
  },

  // --- POOL MANAGEMENT ---
  pools: {
    getPools: (nh, query) => nh.call({ method: 'GET', path: '/main/api/v2/pools', query }),
    getPoolDetails: (nh, poolId) => nh.call({ method: 'GET', path: `/main/api/v2/pool/${poolId}` }),
    createPool: (nh, body) => nh.call({ method: 'POST', path: '/main/api/v2/pool', body }),
    deletePool: (nh, poolId) => nh.call({ method: 'DELETE', path: `/main/api/v2/pool/${poolId}` }),
    verifyPool: (nh, body) => nh.call({ method: 'POST', path: '/main/api/v2/pools/verify', body }),
  }
};

/**
 * Express API Endpoints
 */

const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(err => {
    console.error(`[api:error] ${req.method} ${req.originalUrl}`, err);
    const status = err.statusCode || 500;

    if (status === 429 && err.headers) {
      if (err.headers['retry-after']) res.set('Retry-After', err.headers['retry-after']);
      if (err.headers['x-ratelimit-limit']) res.set('X-RateLimit-Limit', err.headers['x-ratelimit-limit']);
    }

    res.status(status).json({ error: err.message });
  });
};

// Public
app.get('/api/v2/time', asyncHandler(async (req, res) => res.json(await NiceHashApp.public.getTime(resolveNhClient()))));
app.get('/api/v2/algorithms', asyncHandler(async (req, res) => res.json(await NiceHashApp.public.getAlgorithms(resolveNhClient()))));
app.get('/api/v2/public/currency-algos', asyncHandler(async (req, res) => res.json(await NiceHashApp.easyMining.getCurrencyAlgos(resolveNhClient()))));
app.get('/api/v2/mining/markets', asyncHandler(async (req, res) => res.json(await NiceHashApp.public.getMarkets(resolveNhClient()))));
app.get('/api/v2/public/stats/24h', asyncHandler(async (req, res) => res.json(await NiceHashApp.hashpower.getGlobalStats24h(resolveNhClient()))));

// Accounting
app.get('/api/v2/accounting/balances', asyncHandler(async (req, res) => res.json(await NiceHashApp.accounting.getBalances(resolveNhClient()))));
app.get('/api/v2/accounting/balance/:currency', asyncHandler(async (req, res) => res.json(await NiceHashApp.accounting.getBalance(resolveNhClient(), req.params.currency))));
app.post('/api/v2/accounting/withdrawal', asyncHandler(async (req, res) => res.json(await NiceHashApp.accounting.createWithdrawal(resolveNhClient(), req.body))));
app.get('/api/v2/mining/address', asyncHandler(async (req, res) => res.json(await NiceHashApp.mining.getMiningAddress(resolveNhClient()))));

// Mining
app.get('/api/v2/mining/rigs2', asyncHandler(async (req, res) => {
  const nhClient = resolveNhClient();
  if (parseInt(req.query.size || '0', 10) > 100) {
    return res.json(await fetchAllPages(nhClient, NiceHashApp.mining.getRigs, req.query));
  }
  res.json(await NiceHashApp.mining.getRigs(nhClient, req.query));
}));

app.get('/api/v2/mining/rig/:rigId', asyncHandler(async (req, res) => res.json(await NiceHashApp.mining.getRigDetails(resolveNhClient(), req.params.rigId))));
app.post('/api/v2/mining/rigs/status', asyncHandler(async (req, res) => res.json(await NiceHashApp.mining.setRigStatus(resolveNhClient(), req.body))));
app.get('/api/v2/mining/payouts', asyncHandler(async (req, res) => {
  const nhClient = resolveNhClient();
  if (parseInt(req.query.size || '0', 10) > 100) {
    return res.json(await fetchAllPages(nhClient, NiceHashApp.mining.getPayouts, req.query));
  }
  res.json(await NiceHashApp.mining.getPayouts(nhClient, req.query));
}));
app.get('/api/v2/mining/history', asyncHandler(async (req, res) => res.json(await NiceHashApp.mining.getRigsStatsHistory(resolveNhClient(), req.query))));
app.get('/api/v2/mining/algo-stats', asyncHandler(async (req, res) => res.json(await NiceHashApp.mining.getAlgoStats(resolveNhClient(), req.query))));

// Hashpower
app.get('/api/v2/hashpower/myOrders', asyncHandler(async (req, res) => {
  const nhClient = resolveNhClient();
  const query = { ...req.query };
  if (!query.ts) query.ts = Date.now().toString();

  let data;
  if (parseInt(query.size || '0', 10) > 100) {
    data = await fetchAllPages(nhClient, NiceHashApp.hashpower.getMyOrders, query);
  } else {
    data = await NiceHashApp.hashpower.getMyOrders(nhClient, query);
  }

  // Save to CSV on the server side (current path)
  const list = data?.list || data?.myOrders || (Array.isArray(data) ? data : []);
  if (list && list.length > 0) {
    try {
      const flattenedData = list.map(o => ({
        id: o.id || '',
        algorithm: typeof o.algorithm === 'object' ? o.algorithm.algorithm : o.algorithm,
        market: typeof o.market === 'object' ? o.market.id : o.market,
        price: o.price,
        limit: o.limit,
        speed: o.acceptedCurrentSpeed || 0,
        poolHost: o.pool?.stratumHostname || '',
        poolUser: o.pool?.username || '',
        poolPass: o.pool?.password || '',
        status: typeof o.status === 'object' ? o.status.code : o.status,
        ts: new Date().toISOString()
      }));

      const headers = Object.keys(flattenedData[0]).join(',');
      const rows = flattenedData.map(row => 
        Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
      ).join('\n');

      const csvContent = `${headers}\n${rows}`;
      const filePath = path.join(process.cwd(), 'orders.xlsx');
      await fs.writeFile(filePath, csvContent, 'utf-8');
      console.log(`[excel] Overwritten orders list to: ${filePath}`);
    } catch (csvErr) {
      console.error('[excel] Failed to save orders:', csvErr.message);
    }
  }
  res.json(data);
}));
app.get('/api/v2/hashpower/order/:orderId', asyncHandler(async (req, res) => res.json(await NiceHashApp.hashpower.getOrderDetail(resolveNhClient(), req.params.orderId))));
app.post('/api/v2/hashpower/order', asyncHandler(async (req, res) => res.json(await NiceHashApp.hashpower.createOrder(resolveNhClient(), req.body))));
app.get('/api/v2/hashpower/order-book', asyncHandler(async (req, res) => res.json(await NiceHashApp.hashpower.getOrderBook(resolveNhClient(), req.query))));
app.delete('/api/v2/hashpower/order/:orderId', asyncHandler(async (req, res) => res.json(await NiceHashApp.hashpower.cancelOrder(resolveNhClient(), req.params.orderId))));
app.post('/api/v2/hashpower/order/:orderId/refill', asyncHandler(async (req, res) => res.json(await NiceHashApp.hashpower.refillOrder(resolveNhClient(), req.params.orderId, req.body))));
app.post('/api/v2/hashpower/order/:orderId/update', asyncHandler(async (req, res) => res.json(await NiceHashApp.hashpower.updatePriceLimit(resolveNhClient(), req.params.orderId, req.body))));

// Pools
app.get('/api/v2/pools', asyncHandler(async (req, res) => {
  const nhClient = resolveNhClient();
  if (parseInt(req.query.size || '0', 10) > 100) {
    return res.json(await fetchAllPages(nhClient, NiceHashApp.pools.getPools, req.query));
  }
  res.json(await NiceHashApp.pools.getPools(nhClient, req.query));
}));
app.get('/api/v2/pool/:poolId', asyncHandler(async (req, res) => res.json(await NiceHashApp.pools.getPoolDetails(resolveNhClient(), req.params.poolId))));
app.post('/api/v2/pool', asyncHandler(async (req, res) => res.json(await NiceHashApp.pools.createPool(resolveNhClient(), req.body))));
app.post('/api/v2/pools/verify', asyncHandler(async (req, res) => res.json(await NiceHashApp.pools.verifyPool(resolveNhClient(), req.body))));

// Error handling wrapper for Express

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, (err) => {
  if (err) {
    console.error(`[api] Failed to bind port ${PORT}:`, err.message);
    process.exit(1);
    return;
  }

  console.log(`--- NiceHash API Toolbox Server Started ---`);
  console.log(`Port: ${PORT}`);
  console.log(`Listening on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  console.error(`[api] Server error on port ${PORT}:`, err.message);
});

function shutdown(signal) {
  console.log(`[api] Received ${signal}, shutting down...`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/**
 * Keep logic for local execution if needed
 */
if (process.env.RUN_MAIN === 'true') {
  try {
    // Connectivity check on startup
    NiceHashApp.public.getTime().then(t => console.log('✅ Connection verified. Server Time:', new Date(t).toLocaleString()));
  } catch (error) {
    console.error('❌ Connectivity Error:', error.message);
  }
}
function normalizeCredential(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^['"]|['"]$/g, '').trim();
}
