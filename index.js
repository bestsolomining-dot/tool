import 'dotenv/config';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { createHash, createHmac } from 'crypto';
import { request } from 'undici';
import { NiceHashClient } from './NiceHashClient.js';
import { mapNiceHashToMRR } from './src/core/algoMapping.js';

const app = express();
app.set('etag', false); // Disable ETags to prevent 304 caching on API errors
app.use(express.json());
const mrrLastNonceByClient = new Map();
const mrrQueueByClient = new Map();
const mrrInstances = new Map();

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
const nhConfigs = {
  BT: {
    apiKey: normalizeCredential(process.env.NICEHASH_API_KEY),
    apiSecret: normalizeCredential(process.env.NICEHASH_API_SECRET),
    orgId: normalizeCredential(process.env.NICEHASH_ORG_ID),
    environment: normalizeCredential(process.env.NICEHASH_ENVIRONMENT || 'production')
  },
  PH: {
    apiKey: normalizeCredential(process.env.NICEHASH_API_KEY_PH),
    apiSecret: normalizeCredential(process.env.NICEHASH_API_SECRET_PH),
    orgId: normalizeCredential(process.env.NICEHASH_ORG_ID_PH),
    environment: normalizeCredential(process.env.NICEHASH_ENVIRONMENT_PH || process.env.NICEHASH_ENVIRONMENT || 'production')
  }
};

const mrrConfigs = {
  BT: {
    apiKey: normalizeCredential(process.env.MRR_KEY_RIG_BT),
    apiSecret: normalizeCredential(process.env.MRR_SECRET_RIG_BT),
  },
  SL: {
    apiKey: normalizeCredential(process.env.MRR_KEY_RIG_SL),
    apiSecret: normalizeCredential(process.env.MRR_SECRET_RIG_SL),
  },
  ALL: {
    apiKey: normalizeCredential(process.env.MRR_KEY_RIG_VN),
    apiSecret: normalizeCredential(process.env.MRR_SECRET_RIG_VN),
  },
};
const defaultMrrClientRaw = String(process.env.MRR_DEFAULT_CLIENT || 'BT').trim().toUpperCase();
const defaultMrrClient = (function () {
  if (mrrConfigs[defaultMrrClientRaw]) return defaultMrrClientRaw;
  // Fallback logic
  if (defaultMrrClientRaw === 'SL') return 'SL';
  if (defaultMrrClientRaw === 'VN') return 'VN';
  return 'BT';
})();

const nhInstances = new Map();

function resolveNhClient(clientNameRaw) {
  const clientName = String(clientNameRaw || 'BT').trim().toUpperCase();
  const targetName = nhConfigs[clientName] ? clientName : 'BT';

  if (!nhInstances.has(targetName)) {
    const cfg = nhConfigs[targetName];
    if (cfg.apiKey && cfg.apiSecret && cfg.orgId) {
      try {
        const newClient = new NiceHashClient({ ...cfg, name: targetName });
        nhInstances.set(targetName, newClient);
        return { client: newClient, clientName: targetName };
      } catch (e) {
        console.error(`[api:error] Failed to create NiceHashClient for "${targetName}" due to invalid configuration: ${e.message}`);
        // Fallback to BT if client creation fails
      }
    }
    
    // If target (like PH) isn't configured or client creation failed, fallback to BT and warn
    const btClient = nhInstances.get('BT');
    if (targetName !== 'BT') console.warn(`[api:warn] Client "${targetName}" is not fully configured in .env. Falling back to BT.`);
    return { client: btClient, clientName: 'BT' };
  }
  return { client: nhInstances.get(targetName) || nhInstances.get('BT'), clientName: targetName };
}

const getNiceHashApp = (client) => ({
  // --- PUBLIC DATA ---
  public: {
    getTime: () => client.getServerTime(),
    getDoc: () => client.call({ method: 'GET', path: '/api/v2/doc' }),
    getAlgorithms: () => client.call({ method: 'GET', path: '/main/api/v2/mining/algorithms' }),
    getMarkets: () => client.call({ method: 'GET', path: '/main/api/v2/mining/markets' }),
    getCurrencies: () => client.call({ method: 'GET', path: '/main/api/v2/public/currencies' }),
    getNetworks: () => client.call({ method: 'GET', path: '/main/api/v2/public/networks' }),
    getFeeInfo: () => client.call({ method: 'GET', path: '/main/api/v2/public/service/fee/info' }),
    getCountries: () => client.call({ method: 'GET', path: '/api/v2/enum/countries' }),
    getOrgIndustry: () => client.call({ method: 'GET', path: '/api/v2/enum/organisationIndustry' }),
    getPermissions: () => client.call({ method: 'GET', path: '/api/v2/enum/permissions' }),
    getXchCountries: () => client.call({ method: 'GET', path: '/api/v2/enum/xchCountries' }),
    getSystemFlags: () => client.call({ method: 'GET', path: '/api/v2/system/flags' }),
  },

  // --- ACCOUNTING & WALLET ---
  accounting: {
    getBalances: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/accounts2', query: { ts: Date.now().toString() } }),
    getBalance: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/account2/${currency}`, query: { ts: Date.now().toString() } }),
    getActivitiesAll: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/activities', query: { ts: Date.now().toString() } }),
    getActivity: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/activity/${currency}`, query: { ts: Date.now().toString() } }),
    getCurrencies: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/currencies', query: { ts: Date.now().toString() } }),
    getDepositAddressLn: (body) => client.call({ method: 'POST', path: '/main/api/v2/accounting/depositAddress/ln', body }),
    getDepositAddresses: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/depositAddresses', query: { ts: Date.now().toString() } }),
    getDepositsAll: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/deposits', query: { ts: Date.now().toString() } }),
    getDeposits: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/deposits/${currency}`, query: { ts: Date.now().toString() } }),
    getDepositDetail: (currency, id) => client.call({ method: 'GET', path: `/main/api/v2/accounting/deposits2/${currency}/${id}`, query: { ts: Date.now().toString() } }),
    getExchangeTrades: (id) => client.call({ method: 'GET', path: `/main/api/v2/accounting/exchange/${id}/trades`, query: { ts: Date.now().toString() } }),
    getHashpowerTransactions: (id) => client.call({ method: 'GET', path: `/main/api/v2/accounting/hashpower/${id}/transactions`, query: { ts: Date.now().toString() } }),
    getMiningEarnings: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/hashpowerEarnings/${currency}`, query: { ts: Date.now().toString() } }),
    getIndividualBalance: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/individual/balance', query: { ts: Date.now().toString() } }),
    listVirginUtxos: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/list/virginUtxo', query: { ts: Date.now().toString() } }),
    selectVirginUtxo: (body) => client.call({ method: 'POST', path: '/main/api/v2/accounting/select/virginUtxo', body }),
    getTransaction: (currency, transactionId) => client.call({ method: 'GET', path: `/main/api/v2/accounting/transaction/${currency}/${transactionId}`, query: { ts: Date.now().toString() } }),
    getTransactions: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/transactions/${currency}`, query: { ts: Date.now().toString() } }),
    transitionConsolidation: (body) => client.call({ method: 'POST', path: '/main/api/v2/accounting/transition/consolidation', body }),
    getTravelRuleData: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/travelrule/transaction/data', query: { ts: Date.now().toString() } }),
    getTravelRuleVasps: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/travelrule/vasps', query: { ts: Date.now().toString() } }),
    resolveWithheld: (id) => client.call({ method: 'POST', path: `/main/api/v2/accounting/travelrule/withheldDeposit/resolve/${id}` }),
    createWithdrawal: (body) => client.call({ method: 'POST', path: '/main/api/v2/accounting/withdrawal', body }),
    cancelWithdrawal: (currency, id) => client.call({ method: 'DELETE', path: `/main/api/v2/accounting/withdrawal/${currency}/${id}` }),
    getWithdrawalDetail: (currency, id) => client.call({ method: 'GET', path: `/main/api/v2/accounting/withdrawal2/${currency}/${id}`, query: { ts: Date.now().toString() } }),
    getWithdrawalAddress: (id) => client.call({ method: 'GET', path: `/main/api/v2/accounting/withdrawalAddress/${id}`, query: { ts: Date.now().toString() } }),
    getWithdrawalAddresses: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/withdrawalAddresses', query: { ts: Date.now().toString() } }),
    getWithdrawals: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/withdrawals/${currency}`, query: { ts: Date.now().toString() } }),
  },

  // --- RIG MANAGEMENT (MINER PRIVATE) ---
  mining: {
    getMiningAddress: () => client.call({ method: 'GET', path: '/main/api/v2/mining/miningAddress', query: { ts: Date.now().toString() } }),
    getAlgoStats: () => client.call({ method: 'GET', path: '/main/api/v2/mining/algo/stats', query: { ts: Date.now().toString() } }),
    getGroups: () => client.call({ method: 'GET', path: '/main/api/v2/mining/groups/list', query: { ts: Date.now().toString() } }),
    getRigStatsAlgo: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rig/stats/algo', query: { ts: Date.now().toString() } }),
    getRigStatsUnpaid: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rig/stats/unpaid', query: { ts: Date.now().toString() } }),
    getRigDetails: (rigId) => client.call({ method: 'GET', path: `/main/api/v2/mining/rig2/${rigId}`, query: { ts: Date.now().toString() } }),
    getRigsLegacy: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs', query: { ts: Date.now().toString() } }),
    getActiveWorkers: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/activeWorkers', query: { ts: Date.now().toString() } }),
    getPayouts: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/payouts', query: { ts: Date.now().toString() } }),
    getRigsStatsAlgo: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/algo', query: { ts: Date.now().toString() } }),
    getRigsStatsData: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/data', query: { ts: Date.now().toString() } }),
    getRigsStatsDataAlgo: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/data/algo', query: { ts: Date.now().toString() } }),
    getRigsStatsHistory: (query) => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/history', query }),
    getRigsStatsUnpaid: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/unpaid', query: { ts: Date.now().toString() } }),
    setRigStatus: (body) => client.call({ method: 'POST', path: '/main/api/v2/mining/rigs/status2', body }),
    getRigs: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs2', query: { ts: Date.now().toString() } }),
    exportOfflineRigs: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs2/exportOffline', query: { ts: Date.now().toString() } }),
  },

  // --- HASHPOWER MARKETPLACE ---
  hashpower: {
    getBusinessBuyerStats: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/business/buyer/stats' }),
    getBusinessBuyerInfo: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/business/buyers/info' }),
    getMyOrders: (query) => client.call({ method: 'GET', path: '/main/api/v2/hashpower/myOrders', query: { orgId: client.orgId, ...query } }),
    createOrder: (orderData) => client.call({ method: 'POST', path: '/main/api/v2/hashpower/order', body: orderData }),
    getOrderDetail: (orderId) => client.call({ method: 'GET', path: `/main/api/v2/hashpower/order/${orderId}`, query: { ts: Date.now().toString() } }),
    cancelOrder: (orderId) => client.call({ method: 'DELETE', path: `/main/api/v2/hashpower/order/${orderId}` }),
    refillOrder: (orderId, body) => client.call({ method: 'POST', path: `/main/api/v2/hashpower/order/${orderId}/refill`, body }),
    updatePriceLimit: (orderId, body) => client.call({ method: 'POST', path: `/main/api/v2/hashpower/order/${orderId}/updatePriceAndLimit`, body }),
    getVmmOrders: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/vmm/orders', query: { ts: Date.now().toString() } }),
    // Public Hashpower
    getOrderPrice: (query) => client.call({ method: 'GET', path: '/main/api/v2/hashpower/order/price', query }),
    getOrderBook: (query) => client.call({ method: 'GET', path: '/main/api/v2/hashpower/orderBook', query: { ts: Date.now().toString(), ...query } }),
    getGlobalStats24h: () => client.call({ method: 'GET', path: '/main/api/v2/public/stats/global/24h' }),
  },

  // --- EASYMINING ---
  easyMining: {
    getMassBuyConfigs: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/easymining/massbuy/configurations', query: { ts: Date.now().toString() } }),
    getSoloOrders: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/solo/order', query: { ts: Date.now().toString() } }),
    buySoloPackage: (body) => client.call({ method: 'POST', path: '/main/api/v2/hashpower/solo/order', body }),
    // Public EasyMining
    getCurrencyAlgos: () => client.call({ method: 'GET', path: '/main/api/v2/public/currency-algos' }),
    getPackages: () => client.call({ method: 'GET', path: '/main/api/v2/public/easymining/packages' }),
  },

  // --- POOL MANAGEMENT ---
  pools: {
    getPools: () => client.call({ method: 'GET', path: '/main/api/v2/pools' }),
    getPoolDetails: (poolId) => client.call({ method: 'GET', path: `/main/api/v2/pool/${poolId}` }),
    createPool: (body) => client.call({ method: 'POST', path: '/main/api/v2/pool', body }),
    deletePool: (poolId) => client.call({ method: 'DELETE', path: `/main/api/v2/pool/${poolId}` }),
    verifyPool: (body) => client.call({ method: 'POST', path: '/main/api/v2/pools/verify', body }),
  }
});

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

// MRR Middleware to resolve client and attach app helper
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

// Public
app.get('/api/v2/time', asyncHandler(async (req, res) => res.json(await req.nhApp.public.getTime())));
app.get('/api/v2/algorithms', asyncHandler(async (req, res) => res.json(await req.nhApp.public.getAlgorithms())));
app.get('/api/v2/public/currency-algos', asyncHandler(async (req, res) => res.json(await req.nhApp.easyMining.getCurrencyAlgos())));
app.get('/api/v2/mining/markets', asyncHandler(async (req, res) => res.json(await req.nhApp.public.getMarkets())));
app.get('/api/v2/public/stats/24h', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.getGlobalStats24h())));
app.get('/api/v2/algos/mapping', asyncHandler(async (req, res) => {
  const { client: nhClient, clientName: nhClientName } = resolveNhClient(req.query.client);
  const nhResponse = await getNiceHashApp(nhClient).public.getAlgorithms();
  const { data: mrrResponse, clientName } = await mrrApiCall({
    endpoint: '/info/algos',
    method: 'GET',
    clientNameRaw: req.query.client,
  });

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

// Accounting
app.get('/api/v2/accounting/balances', asyncHandler(async (req, res) => res.json(await req.nhApp.accounting.getBalances())));
app.get('/api/v2/accounting/balance/:currency', asyncHandler(async (req, res) => res.json(await req.nhApp.accounting.getBalance(req.params.currency))));
app.post('/api/v2/accounting/withdrawal', asyncHandler(async (req, res) => res.json(await req.nhApp.accounting.createWithdrawal(req.body))));
app.get('/api/v2/mining/address', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.getMiningAddress())));

// Mining
app.get('/api/v2/mining/rigs2', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.getRigs())));
app.get('/api/v2/mining/rig/:rigId', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.getRigDetails(req.params.rigId))));
app.post('/api/v2/mining/rigs/status', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.setRigStatus(req.body))));
app.get('/api/v2/mining/payouts', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.getPayouts())));
app.get('/api/v2/mining/history', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.getRigsStatsHistory(req.query))));
app.get('/api/v2/mining/algo-stats', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.getAlgoStats())));

// Hashpower
app.get('/api/v2/hashpower/myOrders', asyncHandler(async (req, res) => {
  const query = { ...req.query };
  if (!query.ts) query.ts = Date.now().toString();
  console.log('Backend received /api/v2/hashpower/myOrders with query:', query);
  const data = await req.nhApp.hashpower.getMyOrders(query);

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
app.get('/api/v2/hashpower/order/:orderId', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.getOrderDetail(req.params.orderId))));
app.post('/api/v2/hashpower/order', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.createOrder(req.body))));
app.get('/api/v2/hashpower/order-book', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.getOrderBook(req.query))));
app.delete('/api/v2/hashpower/order/:orderId', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.cancelOrder(req.params.orderId))));
app.post('/api/v2/hashpower/order/:orderId/refill', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.refillOrder(req.params.orderId, req.body))));
app.post('/api/v2/hashpower/order/:orderId/update', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.updatePriceLimit(req.params.orderId, req.body))));

// Pools
app.get('/api/v2/pools', asyncHandler(async (req, res) => res.json(await req.nhApp.pools.getPools())));
app.get('/api/v2/pool/:poolId', asyncHandler(async (req, res) => res.json(await req.nhApp.pools.getPoolDetails(req.params.poolId))));
app.post('/api/v2/pool', asyncHandler(async (req, res) => res.json(await req.nhApp.pools.createPool(req.body))));
app.post('/api/v2/pools/verify', asyncHandler(async (req, res) => res.json(await req.nhApp.pools.verifyPool(req.body))));

// --- MINING RIG RENTALS V2 ---
function nextMrrNonce(clientName) {
  // Use BigInt to support huge nonces without precision loss
  const lastNonce = BigInt(mrrLastNonceByClient.get(clientName) || 0n);
  const now = BigInt(Date.now());
  const nonce = now > lastNonce ? now : lastNonce + 1n;
  
  mrrLastNonceByClient.set(clientName, nonce);
  return nonce.toString();
}

function resolveMrrClient(clientNameRaw) {
  const clientName = String(clientNameRaw || defaultMrrClient).toUpperCase(); // Use default if not provided

  if (!mrrInstances.has(clientName)) {
    let config = mrrConfigs[clientName];
    
    const envKey = process.env[`MRR_KEY_RIG_${clientName}`] || 
                   process.env[`MRR_API_KEY_${clientName}`];
    const envSecret = process.env[`MRR_SECRET_RIG_${clientName}`] || 
                     process.env[`MRR_API_SECRET_${clientName}`];

    const envNonce = process.env[`RIG_${clientName}_NOUNCE`]; // Read nonce from environment

    if (envKey && envSecret) {
      config = {
        apiKey: normalizeCredential(envKey),
        apiSecret: normalizeCredential(envSecret),
      };
    }

    if (config?.apiKey && config?.apiSecret) {
      mrrInstances.set(clientName, config);
      
      if (envNonce) {
        try {
          const bigEnv = BigInt(envNonce);
          const now = BigInt(Date.now());
          const initialNonce = bigEnv > now ? bigEnv : now;
          mrrLastNonceByClient.set(clientName, initialNonce.toString());
          console.log(`[mrr:${clientName}] Initializing nonce from environment: ${initialNonce.toString()}`);
        } catch (e) {
          console.warn(`[mrr:${clientName}] Invalid nonce in environment: ${envNonce}`);
        }
      }
    }
  }

  const clientConfig = mrrInstances.get(clientName);
  if (!clientConfig) {
    const err = new Error(`MRR credentials missing for client "${clientName}". Ensure MRR_KEY_RIG_${clientName} and MRR_SECRET_RIG_${clientName} are set in .env.`);
    err.statusCode = 400;
    throw err;
  }

  return { clientName, clientConfig };
}

function extractAlgorithmItems(payload, candidateKeys = []) {
  if (!payload || typeof payload !== 'object') return [];

  for (const key of candidateKeys) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const nestedKey of candidateKeys) {
        if (Array.isArray(value[nestedKey])) return value[nestedKey];
      }
    }
  }

  // Generic deep search if specific keys don't yield an array
  const visited = new WeakSet();
  const queue = [payload];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);

    if (Array.isArray(node)) {
      // If it's an array, check if its elements are algorithm items
      if (node.every(item => typeof item === 'object' && (item.algo || item.algorithm || item.name))) {
        return node;
      }
      // Otherwise, add individual items to the queue for deeper inspection
      for (const item of node) {
        if (item && typeof item === 'object') queue.push(item);
      }
    } else {
      // If it's an object, check its properties
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          // If a property is an array, check if its elements are algorithm items
          if (value.every(item => typeof item === 'object' && (item.algo || item.algorithm || item.name))) {
            return value;
          }
          // Otherwise, add individual items to the queue
          for (const item of value) {
            if (item && typeof item === 'object') queue.push(item);
          }
        } else if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }
  }
  return [];
}

function sanitizeMrrEndpoint(rawEndpoint) {
  const value = String(rawEndpoint || '').trim();
  if (!value) {
    const err = new Error('MRR endpoint is required.');
    err.statusCode = 400;
    throw err;
  }

  const normalized = value.startsWith('/') ? value : `/${value}`;
  return normalized.replace(/\/+$/, '') || '/';
}

async function runMrrCallInOrder(clientName, task) {
  const previous = mrrQueueByClient.get(clientName) || Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(task);

  mrrQueueByClient.set(clientName, current);

  try {
    return await current;
  } finally {
    if (mrrQueueByClient.get(clientName) === current) {
      mrrQueueByClient.delete(clientName);
    }
  }
}

async function mrrApiCall({ endpoint, method = 'GET', query, body, clientNameRaw }) {
  const { clientName, clientConfig } = resolveMrrClient(clientNameRaw);
  return runMrrCallInOrder(clientName, async () => {
    const normalizedEndpoint = sanitizeMrrEndpoint(endpoint);
    const requestMethod = String(method || 'GET').toUpperCase();

    const hasBody = body !== undefined && body !== null && requestMethod !== 'GET' && requestMethod !== 'DELETE';
    const baseUrl = new URL(`https://www.miningrigrentals.com/api/v2${normalizedEndpoint}`);
    if (query && typeof query === 'object') {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        baseUrl.searchParams.set(key, String(value));
      }
    }

    // Endpoint for signature: relative to /api/v2, no query string
    const sigEndpoint = baseUrl.pathname.replace(/^\/api\/v2/, '');
    
    const send = async (nStr, sig, authHeaders = {}) => request(baseUrl.toString(), {
      method: requestMethod,
      headers: {
        'user-agent': 'Ben Tre Mining Tool/2.0',
        'accept': 'application/json',
        'cache-control': 'no-store, no-cache, must-revalidate',
        ...authHeaders,
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
    });

    // --- TRY MODERN V2 (HMAC-SHA1) ---
    let currentNonce = nextMrrNonce(clientName);
    let signString = `${clientConfig.apiKey}${currentNonce}${sigEndpoint}`;
    let signature = createHmac('sha1', clientConfig.apiSecret).update(signString).digest('hex');

    let response = await send(currentNonce, signature, {
      'x-api-key': clientConfig.apiKey,
      'x-api-nonce': currentNonce,
      'x-api-sign': signature
    });

    let text = await response.body.text();
    let data;
    try {
      data = text ? JSON.parse(text) : { success: false, message: 'Empty response' };
    } catch {
      data = { success: false, message: text };
    }

    // --- FALLBACK TO LEGACY (SHA1 CONCAT) ---
    let authMessage = String(data?.data?.message || data?.message || '');
    let isAuthFailureMessage = /signature|unauthorized|authenticated|invalid/i.test(authMessage);
    const shouldRetry = !data.success && isAuthFailureMessage;

    if (shouldRetry) {
      console.warn(`[mrr:${clientName}] HMAC failed, retrying with Legacy SHA1 Concatenation...`);
      currentNonce = nextMrrNonce(clientName);
      const legacyStr = `${clientConfig.apiKey}${currentNonce}${sigEndpoint}${clientConfig.apiSecret}`;
      const legacySig = createHash('sha1').update(legacyStr).digest('hex');

      const retryRes = await send(currentNonce, legacySig, {
        'x-mrr-key': clientConfig.apiKey,
        'x-mrr-nonce': currentNonce,
        'x-mrr-signature': legacySig
      });
      const retryText = await retryRes.body.text();
      try {
        data = JSON.parse(retryText);
        response = retryRes;
        authMessage = String(data?.data?.message || data?.message || '');
        isAuthFailureMessage = /signature|unauthorized|authenticated|invalid/i.test(authMessage);
      } catch (e) { /* fallback to original error if retry response isn't JSON */ }
    }

    // Force 401 error status if MRR returns success: false or an auth error message
    let finalStatus = response.statusCode;
    if ((data?.success === false || isAuthFailureMessage) && finalStatus < 400) {
      finalStatus = 401;
    }

    console.log(`[mrr:${clientName}] endpoint=${normalizedEndpoint} nonce=${currentNonce} status=${finalStatus} msg=${authMessage || 'OK'}`);

    return { statusCode: finalStatus, data, clientName };
  });
}

async function mrrRequest(endpoint, req, res, method = 'GET', body = undefined) {
  // Destructure to remove internal parameters (client, endpoint) from the forwarding query
  const { client: clientQuery, endpoint: _internalPath, ...forwardQuery } = req.query || {};
  
  // Default to primary client if 'ALL' is passed to a non-supporting endpoint
  const targetClient = String(clientQuery || '').toUpperCase() === 'ALL' ? defaultMrrClient : clientQuery;

  const { statusCode, data, clientName } = await mrrApiCall({
    endpoint,
    method,
    clientNameRaw: targetClient,
    query: forwardQuery,
    body: body, // Pass the body explicitly for non-GET requests
  });
  res.set('X-MRR-Client', clientName);
  res.status(statusCode).json(data);
}

/**
 * Normalizes MRR Rental data to ensure Algorithm and Hashrate fields are present.
 */
function extractRentalInfo(rental) {
  // MRR often puts the algorithm slug in .rig.type for rentals, but top-level .type is price type.
  const algo = rental.algo || rental.algorithm || rental.miningAlgorithm || rental.rig?.algo || rental.rig?.algorithm || rental.rig?.type || 'Unknown';
  const type = rental.price_type || rental.price?.type || rental.type || 'Day';
  const duration = rental.length || rental.hours || rental.rig?.hours || '0';
  const rigId = rental.rig?.id || rental.rigid || rental.rig_id || rental.rigId || 'N/A';
  const percent = rental.hashrate?.average?.percent || rental.rig?.hashrate?.average?.percent || '0';
  const endTime = rental.end || rental.rig?.status?.end || '';

  let currentHash = 0;
  let advertisedHash = 0;
  let averageHash = 0;
  let hashrateSuffix = '';

  // Check both top level and rig object for hashrate data
  // Prioritize rig hashrate if top-level is empty or zero
  let hr = rental.hashrate;
  if (!hr || (typeof hr === 'object' && !hr.hashrate && !hr.current && !hr.advertised && !hr.nice)) {
    // If top-level hashrate is missing or empty, try rig hashrate
    hr = rental.rig?.hashrate || rental.rig?.hash;
  }

  if (hr && typeof hr === 'object') {
    // MRR hashrate object structure
    currentHash = parseFloat(hr.hashrate || hr.current || hr.hash || 0);
    
    if (hr.advertised && typeof hr.advertised === 'object') {
      advertisedHash = parseFloat(hr.advertised.hash || hr.advertised.hashrate || 0);
      hashrateSuffix = hr.advertised.type || hr.advertised.suffix || '';
    } else {
      advertisedHash = parseFloat(hr.advertised || 0);
    }

    if (hr.average && typeof hr.average === 'object') {
      averageHash = parseFloat(hr.average.hash || hr.average.hashrate || 0);
      hashrateSuffix = hashrateSuffix || hr.average.type || hr.average.suffix || '';
    } else {
      averageHash = parseFloat(hr.average || 0);
    }
    
    hashrateSuffix = hashrateSuffix || hr.suffix || '';
  } else if (typeof hr === 'number' || typeof hr === 'string') {
    currentHash = parseFloat(hr);
    // We might not have a suffix if it's just a number/string
  }

  // Determine a 'nice' formatted hashrate for display
  const niceHashrate = (hr && typeof hr === 'object' && hr.nice) ||
                       (hr && typeof hr === 'object' && hr.advertised?.nice) ||
                       (advertisedHash > 0 ? `${advertisedHash} ${hashrateSuffix}`.trim() : 
                       (currentHash > 0 ? `${currentHash} ${hashrateSuffix}`.trim() : '0 N/A'));

  const niceAverageHashrate = (hr && typeof hr === 'object' && hr.average?.nice) || 
                              (averageHash > 0 ? `${averageHash.toFixed(2)} ${hashrateSuffix}`.trim() : '0 N/A');

  return {
    algo, // Algorithm name (e.g., "SHA256")
    type, // Algorithm type (e.g., "GPU", "CPU")
    duration,
    rigId,
    endTime,
    percent,
    hashrate: { current: currentHash, advertised: advertisedHash, average: averageHash, suffix: hashrateSuffix },
    niceHashrate: niceHashrate,
    niceAverageHashrate: niceAverageHashrate,
  };
}

function extractRigInfo(payload) {
  const queue = [payload];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;

    const miningAlgorithm = node.miningAlgorithm || node.algorithm || node.algo || '';
    const stratumHost = node.stratumHost || node.stratumHostname || node.host || '';
    const stratumPortRaw = node.stratumPort || node.port;
    const stratumPort = Number(stratumPortRaw);
    const username = node.username || node.user || '';
    const password = node.password || node.pass || '';

    if (miningAlgorithm && stratumHost && Number.isFinite(stratumPort) && username && password) {
      return { miningAlgorithm, stratumHost, stratumPort, username, password };
    }

    // If it's a rig object, but missing some fields, check its pools
    if (node.pools && Array.isArray(node.pools)) {
      for (const pool of node.pools) {
        const poolAlgo = pool.algo || pool.algorithm || '';
        const poolHost = pool.stratumHost || pool.host || '';
        const poolUser = pool.username || pool.user || '';
        const poolPass = pool.password || pool.pass || '';
        const poolPortMatch = (poolHost.match(/:(\d+)$/) || [])[1];
        const poolPort = poolPortMatch ? Number(poolPortMatch) : null;

        if (poolAlgo && poolHost && poolUser && poolPass) {
          return { miningAlgorithm: poolAlgo, stratumHost: poolHost, stratumPort: poolPort, username: poolUser, password: poolPass };
        }
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }

  return { miningAlgorithm: '', stratumHost: '', stratumPort: null, username: '', password: '' };
}

app.get('/api/v2/mrr/rigs', asyncHandler(async (req, res) => {
  const clientParam = String(req.query.client || defaultMrrClient).toUpperCase();
  const targetEndpoint = req.query.endpoint || '/rig/mine';

  if (clientParam === 'ALL') {
    const allClientNames = Object.keys(mrrConfigs).filter(c => mrrConfigs[c].apiKey && mrrConfigs[c].apiSecret);
    const allRigs = [];
    const errors = [];

    for (const clientName of allClientNames) {
      try {
        const { data, statusCode } = await mrrApiCall({
          endpoint: targetEndpoint,
          clientNameRaw: clientName,
        });
        
        // Extract rigs from MRR's standard .data envelope
        const rigs = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.data?.rigs) ? data.data.rigs : []);
        if (statusCode === 200 && data?.success && rigs.length > 0) {
          allRigs.push(...rigs.map(rig => ({ ...rig, mrrClient: clientName }))); // Add client identifier
        } else {
          errors.push({ client: clientName, message: data?.message || `Failed to fetch rigs (status: ${statusCode})` });
        }
      } catch (err) {
        errors.push({ client: clientName, message: err.message });
      }
    }
    res.json({ success: true, rigs: allRigs, errors: errors.length > 0 ? errors : undefined });
  } else {
    // Dynamic endpoint selection (Marketplace vs My Rigs)
    await mrrRequest(targetEndpoint, req, res);
  }
}));

/**
 * Aggregated endpoint to fetch pools for all rigs owned by the user.
 */
app.get('/api/v2/mrr/rigs/pools', asyncHandler(async (req, res) => {
  const clientParam = String(req.query.client || defaultMrrClient).toUpperCase();

  // 1. Fetch user's rigs to get IDs
  const { data: rigsData } = await mrrApiCall({
    endpoint: '/rig/mine',
    clientNameRaw: clientParam,
  });

  const rigs = Array.isArray(rigsData?.data) ? rigsData.data : (Array.isArray(rigsData?.data?.rigs) ? rigsData.data.rigs : []);
  
  if (!rigsData?.success || rigs.length === 0) {
    res.set('X-MRR-Client', clientParam);
    return res.json(rigsData || { success: true, data: [] });
  }

  // 2. Fetch pools for all IDs in bulk using the semicolon separator supported by MRR
  const rigIds = rigs.map(r => r.id).join(';');
  const { statusCode, data } = await mrrApiCall({
    endpoint: `/rig/${rigIds}/pool`,
    clientNameRaw: clientParam,
  });

  res.set('X-MRR-Client', clientParam);
  res.status(statusCode).json(data);
}));

app.get('/api/v2/mrr/balance', asyncHandler(async (req, res) => mrrRequest('/account/balance', req, res)));
app.get('/api/v2/mrr/algos', asyncHandler(async (req, res) => mrrRequest('/info/algos', req, res)));
app.get('/api/v2/mrr/profiles', asyncHandler(async (req, res) => mrrRequest('/profile', req, res)));

app.get('/api/v2/mrr/rentals', asyncHandler(async (req, res) => mrrRequest('/rental', req, res)));

app.get('/api/v2/mrr/rental/history', asyncHandler(async (req, res) => {
  // MRR retrieves history via the main rental endpoint with a query flag
  req.query.history = '1';
  return mrrRequest('/rental', req, res);
}));
app.get('/api/v2/mrr/rig/all', asyncHandler(async (req, res) => mrrRequest('/rig', req, res))); // New endpoint for all available rigs
app.get('/api/v2/mrr/whoami', asyncHandler(async (req, res) => mrrRequest('/account/whoami', req, res)));

app.get('/api/v2/mrr/rig', asyncHandler(async (req, res) => mrrRequest('/rig', req, res)));

app.get('/api/v2/mrr/rig/:rigIds', asyncHandler(async (req, res) => mrrRequest(`/rig/${req.params.rigIds}`, req, res)));

app.get('/api/v2/mrr/rig/:rigIds/pool', asyncHandler(async (req, res) => mrrRequest(`/rig/${req.params.rigIds}/pool`, req, res)));

app.get('/api/v2/mrr/rental/:rentalIds', asyncHandler(async (req, res) => {
  const clientParam = String(req.query.client || defaultMrrClient).toUpperCase();
  const rentalId = req.params.rentalIds;

  /** Helper to fetch rental detail with a fallback to the list for richer metadata */
  async function fetchAggressiveRental(clientName) {
    const { statusCode, data } = await mrrApiCall({
      endpoint: `/rental/${rentalId}`,
      clientNameRaw: clientName,
    });

    let rental = data?.data; // The actual rental object is inside 'data' property of the response
    if (statusCode === 200 && data?.success && rental) {
      // Fallback: Specific rental endpoints often miss algo/hashrate. 
      // If missing, search for this ID in the active list which is usually "richer".
      
      // Check normalized values to see if we actually found useful info
      const initialNorm = extractRentalInfo(rental);
      const hasAlgo = initialNorm.algo !== 'Unknown';
      // hasHash should check if we have a meaningful non-zero average hashrate
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

        if (found) {
          rental = { ...found, ...rental };
        }
      }

      // Fetch associated pools for this rental to provide "Full Info" automatically
      const poolRes = await mrrApiCall({ endpoint: `/rental/${rentalId}/pool`, clientNameRaw: clientName });
      if (poolRes.statusCode === 200 && poolRes.data?.success) {
        const pData = poolRes.data.data || poolRes.data;
        rental.pools = Array.isArray(pData.pools) ? pData.pools : (Array.isArray(pData) ? pData : []);
      }
      
      // Attach a normalized object for the UI to consume easily
      const normalized = extractRentalInfo(rental);
      if (data.data) data.data = { ...rental, normalized };
      else Object.assign(data, { ...rental, normalized });
    }
    return { statusCode, data };
  }

  if (clientParam === 'ALL') {
    const clients = Object.keys(mrrConfigs).filter(c => mrrConfigs[c].apiKey && mrrConfigs[c].apiSecret);
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

app.get('/api/v2/mrr/rental/:rentalId/hashrate', asyncHandler(async (req, res) => {
  await mrrRequest(`/rental/${req.params.rentalId}/hashrate`, req, res);
}));

app.put('/api/v2/mrr/rig/:rigId/pool', asyncHandler(async (req, res) => {
  // The MRR API expects pool details in the body for a PUT request
  await mrrRequest(`/rig/${req.params.rigId}/pool`, req, res, 'PUT', req.body);
}));

app.get('/api/v2/mrr/rig/:rigIds/info', asyncHandler(async (req, res) => {
  const ids = req.params.rigIds.split(';').map(id => id.trim()).filter(Boolean);

  if (ids.length === 0) {
    return res.status(400).json({ success: false, message: 'No Rig IDs provided' });
  }

  const fetchSingleInfo = async (id) => {
    try {
      // Use Promise.all inside here if you wanted to fetch both in parallel, 
      // but currently it does a sequential fallback which is safer for rate limits.
      const poolRes = await mrrApiCall({ endpoint: `/rig/${id}/pool`, clientNameRaw: req.query.client });
      let info = extractRigInfo(poolRes.data);

      // Fallback to detailed rig info if pool info is incomplete
      if (!info.miningAlgorithm || !info.stratumHost || !info.username || !info.password || !info.stratumPort) {
        const rigRes = await mrrApiCall({ endpoint: `/rig/${id}`, clientNameRaw: req.query.client });
        info = extractRigInfo(rigRes.data);
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

// --- SERVE FRONTEND ---
// Serve static files from the 'dist' directory (created by npm run build)
const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));

// Catch-all route to serve the React app for any non-API request
app.get(/^(?!\/api).+/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, (err) => {
  if (err) {
    console.error(`[api] Failed to bind port ${PORT}:`, err.message);
    process.exit(1);
    return;
  }

  console.log(`--- NiceHash API Toolbox Server Started ---`);
  console.log(`Environment: ${nhConfigs.BT.environment.toUpperCase()}`);
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
    const { client } = resolveNhClient('BT');
    if (client) {
      getNiceHashApp(client).public.getTime().then(t => console.log('✅ Connection verified. Server Time:', new Date(t).toLocaleString()));
    }
  } catch (error) {
    console.error('❌ Connectivity Error:', error.message);
  }
}
function normalizeCredential(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^['"]|['"]$/g, '').trim();
}
