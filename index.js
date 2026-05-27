import 'dotenv/config';
import express from 'express';
import { createHash, createHmac } from 'crypto';
import { request } from 'undici';
import { NiceHashClient } from './NiceHashClient.js';
import { mapNiceHashToMRR } from './src/core/algoMapping.js';

const app = express();
app.use(express.json());
const mrrLastNonceByClient = new Map();
const mrrQueueByClient = new Map();

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
const config = {
  apiKey: process.env.NICEHASH_API_KEY,
  apiSecret: process.env.NICEHASH_API_SECRET,
  orgId: process.env.NICEHASH_ORG_ID,
  environment: process.env.NICEHASH_ENVIRONMENT || 'production'
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
};
const defaultMrrClientRaw = String(process.env.MRR_DEFAULT_CLIENT || 'BT').trim().toUpperCase();
const defaultMrrClient = defaultMrrClientRaw === 'SL' ? 'SL' : 'BT';

if (!config.apiKey || !config.apiSecret || !config.orgId) {
  console.warn('NICEHASH_API_KEY, NICEHASH_API_SECRET, and NICEHASH_ORG_ID are required for NiceHash v2 requests.')
}

const client = new NiceHashClient(config);

const NiceHashApp = {
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
    getBalances: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/accounts2' }),
    getBalance: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/account2/${currency}` }),
    getActivitiesAll: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/activities' }),
    getActivity: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/activity/${currency}` }),
    getCurrencies: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/currencies' }),
    getDepositAddressLn: (body) => client.call({ method: 'POST', path: '/main/api/v2/accounting/depositAddress/ln', body }),
    getDepositAddresses: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/depositAddresses' }),
    getDepositsAll: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/deposits' }),
    getDeposits: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/deposits/${currency}` }),
    getDepositDetail: (currency, id) => client.call({ method: 'GET', path: `/main/api/v2/accounting/deposits2/${currency}/${id}` }),
    getExchangeTrades: (id) => client.call({ method: 'GET', path: `/main/api/v2/accounting/exchange/${id}/trades` }),
    getHashpowerTransactions: (id) => client.call({ method: 'GET', path: `/main/api/v2/accounting/hashpower/${id}/transactions` }),
    getMiningEarnings: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/hashpowerEarnings/${currency}` }),
    getIndividualBalance: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/individual/balance' }),
    listVirginUtxos: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/list/virginUtxo' }),
    selectVirginUtxo: (body) => client.call({ method: 'POST', path: '/main/api/v2/accounting/select/virginUtxo', body }),
    getTransaction: (currency, transactionId) => client.call({ method: 'GET', path: `/main/api/v2/accounting/transaction/${currency}/${transactionId}` }),
    getTransactions: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/transactions/${currency}` }),
    transitionConsolidation: (body) => client.call({ method: 'POST', path: '/main/api/v2/accounting/transition/consolidation', body }),
    getTravelRuleData: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/travelrule/transaction/data' }),
    getTravelRuleVasps: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/travelrule/vasps' }),
    resolveWithheld: (id) => client.call({ method: 'POST', path: `/main/api/v2/accounting/travelrule/withheldDeposit/resolve/${id}` }),
    createWithdrawal: (body) => client.call({ method: 'POST', path: '/main/api/v2/accounting/withdrawal', body }),
    cancelWithdrawal: (currency, id) => client.call({ method: 'DELETE', path: `/main/api/v2/accounting/withdrawal/${currency}/${id}` }),
    getWithdrawalDetail: (currency, id) => client.call({ method: 'GET', path: `/main/api/v2/accounting/withdrawal2/${currency}/${id}` }),
    getWithdrawalAddress: (id) => client.call({ method: 'GET', path: `/main/api/v2/accounting/withdrawalAddress/${id}` }),
    getWithdrawalAddresses: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/withdrawalAddresses' }),
    getWithdrawals: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/withdrawals/${currency}` }),
  },

  // --- RIG MANAGEMENT (MINER PRIVATE) ---
  mining: {
    getMiningAddress: () => client.call({ method: 'GET', path: '/main/api/v2/mining/miningAddress' }),
    getAlgoStats: () => client.call({ method: 'GET', path: '/main/api/v2/mining/algo/stats' }),
    getGroups: () => client.call({ method: 'GET', path: '/main/api/v2/mining/groups/list' }),
    getRigStatsAlgo: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rig/stats/algo' }),
    getRigStatsUnpaid: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rig/stats/unpaid' }),
    getRigDetails: (rigId) => client.call({ method: 'GET', path: `/main/api/v2/mining/rig2/${rigId}` }),
    getRigsLegacy: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs' }),
    getActiveWorkers: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/activeWorkers' }),
    getPayouts: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/payouts' }),
    getRigsStatsAlgo: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/algo' }),
    getRigsStatsData: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/data' }),
    getRigsStatsDataAlgo: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/data/algo' }),
    getRigsStatsHistory: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/history' }),
    getRigsStatsUnpaid: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs/stats/unpaid' }),
    setRigStatus: (body) => client.call({ method: 'POST', path: '/main/api/v2/mining/rigs/status2', body }),
    getRigs: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs2' }),
    exportOfflineRigs: () => client.call({ method: 'GET', path: '/main/api/v2/mining/rigs2/exportOffline' }),
  },

  // --- HASHPOWER MARKETPLACE ---
  hashpower: {
    getBusinessBuyerStats: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/business/buyer/stats' }),
    getBusinessBuyerInfo: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/business/buyers/info' }),
    getMyOrders: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/myOrders' }),
    createOrder: (orderData) => client.call({ method: 'POST', path: '/main/api/v2/hashpower/order', body: orderData }),
    getOrderDetail: (orderId) => client.call({ method: 'GET', path: `/main/api/v2/hashpower/order/${orderId}` }),
    cancelOrder: (orderId) => client.call({ method: 'DELETE', path: `/main/api/v2/hashpower/order/${orderId}` }),
    refillOrder: (orderId, body) => client.call({ method: 'POST', path: `/main/api/v2/hashpower/order/${orderId}/refill`, body }),
    updatePriceLimit: (orderId, body) => client.call({ method: 'POST', path: `/main/api/v2/hashpower/order/${orderId}/updatePriceAndLimit`, body }),
    getVmmOrders: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/vmm/orders' }),
    // Public Hashpower
    getOrderPrice: (query) => client.call({ method: 'GET', path: '/main/api/v2/hashpower/order/price', query }),
    getOrderBook: (query) => client.call({ method: 'GET', path: '/main/api/v2/hashpower/orderBook', query }),
    getGlobalStats24h: () => client.call({ method: 'GET', path: '/main/api/v2/public/stats/global/24h' }),
  },

  // --- EASYMINING ---
  easyMining: {
    getMassBuyConfigs: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/easymining/massbuy/configurations' }),
    getSoloOrders: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/solo/order' }),
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
app.get('/api/v2/time', asyncHandler(async (req, res) => res.json(await NiceHashApp.public.getTime())));
app.get('/api/v2/algorithms', asyncHandler(async (req, res) => res.json(await NiceHashApp.public.getAlgorithms())));
app.get('/api/v2/public/currency-algos', asyncHandler(async (req, res) => res.json(await NiceHashApp.easyMining.getCurrencyAlgos())));
app.get('/api/v2/mining/markets', asyncHandler(async (req, res) => res.json(await NiceHashApp.public.getMarkets())));
app.get('/api/v2/public/stats/24h', asyncHandler(async (req, res) => res.json(await NiceHashApp.hashpower.getGlobalStats24h())));
app.get('/api/v2/algos/mapping', asyncHandler(async (req, res) => {
  const nhResponse = await NiceHashApp.public.getAlgorithms();
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
app.get('/api/v2/accounting/balances', asyncHandler(async (req, res) => res.json(await NiceHashApp.accounting.getBalances())));
app.get('/api/v2/accounting/balance/:currency', asyncHandler(async (req, res) => res.json(await NiceHashApp.accounting.getBalance(req.params.currency))));
app.post('/api/v2/accounting/withdrawal', asyncHandler(async (req, res) => res.json(await NiceHashApp.accounting.createWithdrawal(req.body))));
app.get('/api/v2/mining/address', asyncHandler(async (req, res) => res.json(await NiceHashApp.mining.getMiningAddress())));

// Mining
app.get('/api/v2/mining/rigs2', asyncHandler(async (req, res) => res.json(await NiceHashApp.mining.getRigs())));
app.get('/api/v2/mining/rig/:rigId', asyncHandler(async (req, res) => res.json(await NiceHashApp.mining.getRigDetails(req.params.rigId))));
app.post('/api/v2/mining/rigs/status', asyncHandler(async (req, res) => res.json(await NiceHashApp.mining.setRigStatus(req.body))));
app.get('/api/v2/mining/payouts', asyncHandler(async (req, res) => res.json(await NiceHashApp.mining.getPayouts())));
app.get('/api/v2/mining/history', asyncHandler(async (req, res) => res.json(await NiceHashApp.mining.getRigsStatsHistory())));
app.get('/api/v2/mining/algo-stats', asyncHandler(async (req, res) => res.json(await NiceHashApp.mining.getAlgoStats())));

// Hashpower
app.get('/api/v2/hashpower/my-orders', asyncHandler(async (req, res) => res.json(await NiceHashApp.hashpower.getMyOrders())));
app.post('/api/v2/hashpower/order', asyncHandler(async (req, res) => res.json(await NiceHashApp.hashpower.createOrder(req.body))));
app.get('/api/v2/hashpower/order-book', asyncHandler(async (req, res) => res.json(await NiceHashApp.hashpower.getOrderBook(req.query))));

// Pools
app.get('/api/v2/pools', asyncHandler(async (req, res) => res.json(await NiceHashApp.pools.getPools())));
app.get('/api/v2/pool/:poolId', asyncHandler(async (req, res) => res.json(await NiceHashApp.pools.getPoolDetails(req.params.poolId))));
app.post('/api/v2/pool', asyncHandler(async (req, res) => res.json(await NiceHashApp.pools.createPool(req.body))));
app.post('/api/v2/pools/verify', asyncHandler(async (req, res) => res.json(await NiceHashApp.pools.verifyPool(req.body))));

// --- MINING RIG RENTALS V2 ---
function resolveMrrClient(clientNameRaw) {
  const clientName = String(clientNameRaw || defaultMrrClient).toUpperCase();
  const clientConfig = mrrConfigs[clientName];

  if (!clientConfig) {
    const err = new Error(`Unknown MRR client "${clientName}". Use BT or SL.`);
    err.statusCode = 400;
    throw err;
  }

  if (!clientConfig.apiKey || !clientConfig.apiSecret) {
    const err = new Error(`MRR credentials missing for client "${clientName}". Expected MRR_KEY_RIG_${clientName} and MRR_SECRET_RIG_${clientName}.`);
    err.statusCode = 400;
    throw err;
  }

  return { clientName, clientConfig };
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

function extractAlgorithmItems(payload, candidateKeys = []) {
  if (!payload || typeof payload !== 'object') return [];

  for (const key of candidateKeys) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      for (const nestedKey of candidateKeys) {
        if (Array.isArray(value[nestedKey])) return value[nestedKey];
      }
    }
  }

  const queue = [payload];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object') queue.push(value);
    }
  }

  return [];
}

function nextMrrNonce(clientName) {
  // MRR nonces must be strictly increasing.
  // We use milliseconds multiplied by 1000 to simulate microseconds, 
  // ensuring that even high-frequency requests remain unique and increasing.
  // We store as string in the map to avoid BigInt serialization issues.
  const now = BigInt(Date.now()) * 1000n;
  const previous = BigInt(mrrLastNonceByClient.get(clientName) || 0);
  const next = now > previous ? now : previous + 1n;
  mrrLastNonceByClient.set(clientName, next.toString());
  return String(next);
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
    const sigEndpoint = normalizedEndpoint.startsWith('/') ? normalizedEndpoint.substring(1) : normalizedEndpoint;

    const nonce = nextMrrNonce(clientName);
    const apiSig = createHmac('sha1', clientConfig.apiSecret)
      .update(`${clientConfig.apiKey}${nonce}${sigEndpoint}`)
      .digest('hex');
    const legacySig = createHash('sha1')
      .update(`${clientConfig.apiKey}${nonce}${sigEndpoint}${clientConfig.apiSecret}`)
      .digest('hex');

    const hasBody = body !== undefined && body !== null && requestMethod !== 'GET' && requestMethod !== 'DELETE';
    const baseUrl = new URL(`https://www.miningrigrentals.com/api/v2${normalizedEndpoint}`);
    if (query && typeof query === 'object') {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        baseUrl.searchParams.set(key, String(value));
      }
    }

    const send = async (headers) => request(baseUrl.toString(), {
      method: requestMethod,
      headers: {
        ...headers,
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
    });

    // Primary auth: documented v2 headers.
    let { statusCode, body: responseBody } = await send({
      'x-api-key': clientConfig.apiKey,
      'x-api-nonce': nonce,
      'x-api-sign': apiSig,
    });

    const text = await responseBody.text();
    let data;
    try {
      data = text ? JSON.parse(text) : { success: false, message: 'Empty response' };
    } catch {
      data = { success: false, message: text };
    }

    // If MRR returns success: false in the body, we treat it as an error
    // even if the HTTP status code is 200.
    const isAuthError = !data.success && (String(data.message).includes('Not Authenticated') || String(data.message).includes('Invalid Key'));

    const authMessage = String(data?.data?.message || data?.message || '');
    const shouldFallbackLegacy =
      statusCode >= 400 || isAuthError ||
      authMessage.includes('Missing API Key');

    if (shouldFallbackLegacy) {
      const legacyResponse = await send({
        'x-mrr-key': clientConfig.apiKey,
        'x-mrr-nonce': nonce,
        'x-mrr-signature': legacySig,
      });
      statusCode = legacyResponse.statusCode;
      const legacyText = await legacyResponse.body.text();
      try {
        data = legacyText ? JSON.parse(legacyText) : {};
      } catch {
        data = { success: false, message: legacyText };
      }
    }

    // If final data still reports failure, ensure statusCode reflects it
    if (data && data.success === false && statusCode === 200) {
      statusCode = 401; // Treat as Unauthorized for the frontend
    }

    return { statusCode, data, clientName };
  });
}

async function mrrRequest(endpoint, req, res, method = 'GET') {
  const { client: _ignoredClient, ...forwardQuery } = req.query || {};
  const { statusCode, data, clientName } = await mrrApiCall({
    endpoint,
    method,
    clientNameRaw: req.query.client,
    query: forwardQuery,
  });
  res.set('X-MRR-Client', clientName);
  res.status(statusCode).json(data);
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

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }

  return { miningAlgorithm: '', stratumHost: '', stratumPort: null, username: '', password: '' };
}

app.get('/api/v2/mrr/rigs', asyncHandler(async (req, res) => mrrRequest('/rig/mine', req, res)));
app.get('/api/v2/mrr/balance', asyncHandler(async (req, res) => mrrRequest('/account/balance', req, res)));
app.get('/api/v2/mrr/algos', asyncHandler(async (req, res) => mrrRequest('/info/algos', req, res)));
app.get('/api/v2/mrr/profiles', asyncHandler(async (req, res) => mrrRequest('/profile', req, res)));
app.get('/api/v2/mrr/rentals', asyncHandler(async (req, res) => mrrRequest('/rental', req, res)));

app.get('/api/v2/mrr/rig/:rigIds/pool', asyncHandler(async (req, res) => {
  const ids = req.params.rigIds.split(';').map(id => id.trim()).filter(Boolean);
  
  if (ids.length === 0) {
    return res.status(400).json({ success: false, message: 'No Rig IDs provided' });
  }

  if (ids.length === 1) {
    return mrrRequest(`/rig/${ids[0]}/pool`, req, res);
  }

  // Handle bulk request by fetching each individually
  const results = await Promise.all(ids.map(async (id) => {
    try {
      const { data } = await mrrApiCall({ 
        endpoint: `/rig/${id}/pool`, 
        clientNameRaw: req.query.client 
      });
      return { rigId: id, ...data };
    } catch (err) {
      return { rigId: id, success: false, message: err.message };
    }
  }));

  res.json({ success: true, data: results });
}));

app.get('/api/v2/mrr/rig/:rigIds/info', asyncHandler(async (req, res) => {
  const ids = req.params.rigIds.split(';').map(id => id.trim()).filter(Boolean);

  if (ids.length === 0) {
    return res.status(400).json({ success: false, message: 'No Rig IDs provided' });
  }

  const fetchSingleInfo = async (id) => {
    try {
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

// Error handling wrapper for Express

// Example: Applying the wrapper to one route
app.get('/api/v2/mining/address', asyncHandler(async (req, res) => {
  const data = await NiceHashApp.mining.getMiningAddress();
  res.json(data);
}));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, (err) => {
  if (err) {
    console.error(`[api] Failed to bind port ${PORT}:`, err.message);
    process.exit(1);
    return;
  }

  console.log(`--- NiceHash API Toolbox Server Started ---`);
  console.log(`Environment: ${config.environment.toUpperCase()}`);
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
