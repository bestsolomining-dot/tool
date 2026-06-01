import 'dotenv/config';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash, createHmac } from 'crypto';
import { request } from 'undici';
import { NiceHashClient } from './NiceHashClient.js';
import { mapNiceHashToMRR, normalizeAlgoForNiceHash } from './src/core/algoMapping.js';
import sqlite3 from 'sqlite3';
import { SyncManager } from './SyncManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- SNAPSHOT DATABASE (Lite) ---
const db = new sqlite3.Database(path.join(process.cwd(), 'mrr_monitor.db'));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS rentals (
    id TEXT PRIMARY KEY,
    name TEXT,
    client TEXT,
    algo TEXT,
    target_100 REAL,
    last_notified INTEGER DEFAULT 0,
    last_updated INTEGER,
    low_hashrate_start INTEGER DEFAULT 0,
    zero_hashrate_start INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS mrr_nonces (
    client TEXT PRIMARY KEY,
    last_nonce TEXT
  )`);
});

/** 
 * Aggregate client identifier. In this setup, 'VN' represents the 
 * aggregated view of all configured clients.
 */
const AGGREGATE_CLIENT = 'VN';
const isAggregate = (c) => {
  const uc = String(c || '').trim().toUpperCase();
  return uc === 'ALL' || uc === AGGREGATE_CLIENT;
};

const app = express();
app.set('etag', false); // Disable ETags to prevent 304 caching on API errors
app.use(express.json());
const mrrLastNonceByClient = new Map();
const mrrQueueByClient = new Map();
const mrrInstances = new Map();

// --- MRR CLOCK SYNC ---
let mrrClockOffset = 0n;
let mrrClockSynced = false;

// Initialize nonces from DB on startup
/** 
 * Loads nonces from DB and returns a promise to ensure initialization 
 * finishes before API calls start.
 */
async function initNonces() {
  return new Promise((resolve) => {
    db.all("SELECT client, last_nonce FROM mrr_nonces", [], (err, rows) => {
      if (!err && rows) {
        rows.forEach(row => {
          try {
            mrrLastNonceByClient.set(row.client, BigInt(row.last_nonce));
            console.log(`[mrr:init] Loaded last nonce baseline for ${row.client}: ${row.last_nonce}`);
          } catch (e) { }
        });
      }
      resolve();
    });
  });
}

let mrrSyncPromise = null;

/**
 * Synchronizes local system time with the NiceHash server time to detect and 
 * mitigate clock drift that causes "Bad Nonce" errors in MRR.
 */
async function syncMrrClock() {
  if (mrrClockSynced) return;
  if (mrrSyncPromise) return mrrSyncPromise;
  console.log('[mrr:clock] Synchronizing with NiceHash server time...');

  mrrSyncPromise = (async () => {
    try {
      const { client } = resolveNhClient('BT');
      if (!client) return;

      const serverTimeMs = await client.getServerTime();
      const localTimeMs = Date.now();
      mrrClockOffset = BigInt(serverTimeMs) - BigInt(localTimeMs);
      mrrClockSynced = true;

      if (Math.abs(Number(mrrClockOffset)) > 1000) {
        console.info(`[mrr:clock] Significant drift detected! Offset: ${mrrClockOffset}ms. (NH Server: ${serverTimeMs}, Local: ${localTimeMs})`);
      } else {
        console.info(`[mrr:clock] Synced with NiceHash. Offset: ${mrrClockOffset}ms.`);
      }
    } catch (err) {
      console.warn(`[mrr:clock] Synchronization failed: ${err.message}. Using raw system clock.`);
      mrrClockSynced = true; // Mark as attempted to avoid blocking every request
    } finally {
      mrrSyncPromise = null;
    }
  })();
  return mrrSyncPromise;
}

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
  const time = new Date().toLocaleTimeString();
  const body = req.method === 'GET' ? '' : ` body=${JSON.stringify(maskSensitive(req.body || {}))}`;

  console.info(`[${time}] [api:${requestId}] -> ${req.method} ${req.originalUrl}${body}`);

  res.on('finish', () => {
    console.info(`[${time}] [api:${requestId}] <- ${res.statusCode} ${req.method} ${req.originalUrl} ${Date.now() - start}ms`);
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

  LN: {
    apiKey: normalizeCredential(process.env.MRR_KEY_RIG_LN),
    apiSecret: normalizeCredential(process.env.MRR_SECRET_RIG_LN),
  },
};

const defaultMrrClientRaw = String(process.env.MRR_DEFAULT_CLIENT || 'BT').trim().toUpperCase();
const defaultMrrClient = (function () {
  if (mrrConfigs[defaultMrrClientRaw]) return defaultMrrClientRaw;
  // Fallback logic
  if (defaultMrrClientRaw === 'SL') return 'SL';
  if (defaultMrrClientRaw === 'VN') return 'VN';
  if (defaultMrrClientRaw === 'LN') return 'LN';
  return 'BT';
})();

const nhInstances = new Map();

function resolveNhClient(clientNameRaw) {
  const clientName = isAggregate(clientNameRaw) ? AGGREGATE_CLIENT : String(clientNameRaw || 'BT').trim().toUpperCase();

  if (isAggregate(clientName)) return { client: nhInstances.get('BT'), clientName: AGGREGATE_CLIENT };

  const targetName = nhConfigs[clientName] ? clientName : 'BT';

  if (!nhInstances.has(targetName)) {
    const cfg = nhConfigs[targetName];
    if (cfg?.apiKey && cfg?.apiSecret && cfg?.orgId) {
      const newClient = new NiceHashClient({ ...cfg, name: targetName });
      nhInstances.set(targetName, newClient);
      return { client: newClient, clientName: targetName };
    }

    // If target isn't configured, fallback to BT only for default requests
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
    createOrder: (orderData) => client.call({ method: 'POST', path: '/main/api/v2/hashpower/order', body: orderData, query: { orgId: client.orgId } }),
    getOrderDetail: (orderId) => client.call({ method: 'GET', path: `/main/api/v2/hashpower/order/${orderId}`, query: { ts: Date.now().toString() } }),
    cancelOrder: (orderId) => client.call({ method: 'DELETE', path: `/main/api/v2/hashpower/order/${orderId}`, query: { orgId: client.orgId } }),
    refillOrder: (orderId, body) => client.call({ method: 'POST', path: `/main/api/v2/hashpower/order/${orderId}/refill`, body, query: { orgId: client.orgId } }),
    updatePriceLimit: (orderId, body) => client.call({ method: 'POST', path: `/main/api/v2/hashpower/order/${orderId}/updatePriceAndLimit`, body, query: { orgId: client.orgId } }),
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
    getPools: async () => {
      const allPools = [];
      let page = 0;
      const size = 100;
      while (true) {
        const res = await client.call({
          method: 'GET',
          path: '/main/api/v2/pools',
          query: { page: page.toString(), size: size.toString() }
        });
        const list = res?.list;
        if (!Array.isArray(list) || list.length === 0) break;
        allPools.push(...list);
        if (list.length < size) break;
        page++;
      }
      return { list: allPools, totalCount: allPools.length };
    },
    getPoolDetails: (poolId) => client.call({ method: 'GET', path: `/main/api/v2/pool/${poolId}` }),
    createPool: (body) => client.call({ method: 'POST', path: '/main/api/v2/pool', body }),
    deletePool: (poolId) => client.call({ method: 'DELETE', path: `/main/api/v2/pool/${poolId}` }),
    verifyPool: (body) => client.call({ method: 'POST', path: '/main/api/v2/pools/verify', body }),
  }
});

/**
 * Database Simulation & Synchronization Logic
 */
const DB_FILE = path.join(process.cwd(), 'database.json');

const syncManager = new SyncManager({
  db, nhConfigs, mrrConfigs, mrrApiCall, resolveNhClient, getNiceHashApp
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

    if (results.length === 0) return res.json({ currencies: [], total: { available: "0", pending: "0", totalBalance: "0", currency: "BTC" } });

    const total = { available: 0, pending: 0, totalBalance: 0, currency: "BTC" };
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
        currency: "BTC"
      }
    });
  }
  res.json(await req.nhApp.accounting.getBalances());
}));
app.get('/api/v2/accounting/balance/:currency', asyncHandler(async (req, res) => res.json(await req.nhApp.accounting.getBalance(req.params.currency))));
app.post('/api/v2/accounting/withdrawal', asyncHandler(async (req, res) => res.json(await req.nhApp.accounting.createWithdrawal(req.body))));
app.get('/api/v2/mining/address', asyncHandler(async (req, res) => res.json(await req.nhApp.mining.getMiningAddress())));

// Mining
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

// Hashpower
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

  // Save to CSV on the server side (current path)
  const list = data?.list || data?.myOrders || (Array.isArray(data) ? data : []);
  if (list && list.length > 0) {
    try {
      const flattenedData = list.map(o => ({
        id: o.id || '',
        account: o.nhClient || clientParam,
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
      const filePath = path.join(process.cwd(), 'orders.csv');
      await fs.writeFile(filePath, csvContent, 'utf-8');
      console.log(`[export] Overwritten orders list to: ${filePath}`);
    } catch (csvErr) {
      console.error('[excel] Failed to save orders:', csvErr.message);
    }
  }
  res.json(data);
}));

/**
 * Fetches total paid amount for ACTIVE (rented) hashpower orders where price < threshold.
 */
app.get('/api/v2/hashpower/rented-summary', asyncHandler(async (req, res) => {
  const maxPrice = parseFloat(req.query.price);
  if (isNaN(maxPrice)) {
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
app.get('/api/v2/hashpower/order/price', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.getOrderPrice(req.query))));
app.delete('/api/v2/hashpower/order/:orderId', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.cancelOrder(req.params.orderId))));
app.post('/api/v2/hashpower/order/:orderId/refill', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.refillOrder(req.params.orderId, req.body))));
app.post('/api/v2/hashpower/order/:orderId/update', asyncHandler(async (req, res) => res.json(await req.nhApp.hashpower.updatePriceLimit(req.params.orderId, req.body))));

// Pools
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

// --- MINING RIG RENTALS V2 ---
async function nextMrrNonce(clientName) {
  const cleanName = String(clientName || '').trim().toUpperCase();
  // Use BigInt to support huge nonces without precision loss
  const lastNonce = BigInt(mrrLastNonceByClient.get(cleanName) || 0n);

  // Sanity check: If the last nonce is already nonsensical (e.g. from a bad .env value), 
  // reset it to 0 before calculating the next one.
  if (lastNonce > 99999999999999999999n) {
    console.warn(`[mrr:${cleanName}] Resetting nonsensical high-watermark nonce (${lastNonce}) to 0.`);
    mrrLastNonceByClient.set(cleanName, 0n);
    return await nextMrrNonce(cleanName);
  }

  const nowMs = BigInt(Date.now()) + mrrClockOffset;

  let nonce;
  // Use 19 digits for high-precision accounts or if the baseline is already high (> 100 trillion)
  if (cleanName === 'BT' || isAggregate(cleanName) || lastNonce > 100000000000000n) {
    const now19 = nowMs * 1000000n; // 19 digits (approx nanoseconds)
    nonce = now19 > lastNonce ? now19 : lastNonce + 1n;
  } else {
    const now14 = nowMs * 10n; // 14 digits (ms + 1 decimal)
    nonce = now14 > lastNonce ? now14 : lastNonce + 1n;
  }

  mrrLastNonceByClient.set(cleanName, nonce);
  await new Promise((resolve) => {
    db.run(
      `INSERT INTO mrr_nonces (client, last_nonce) VALUES (?, ?) 
       ON CONFLICT(client) DO UPDATE SET last_nonce=excluded.last_nonce`,
      [cleanName, nonce.toString()],
      () => resolve()
    );
  });
  return nonce.toString();
}

function resolveMrrClient(clientNameRaw) {
  const clientName = isAggregate(clientNameRaw) ? AGGREGATE_CLIENT : String(clientNameRaw || defaultMrrClient).trim().toUpperCase();
  const lookupSuffix = clientName;

  if (!mrrInstances.has(clientName)) {
    let config = mrrConfigs[clientName];

    const envKey = process.env[`MRR_KEY_RIG_${lookupSuffix}`] ||
      process.env[`MRR_API_KEY_${lookupSuffix}`];
    const envSecret = process.env[`MRR_SECRET_RIG_${lookupSuffix}`] ||
      process.env[`MRR_API_SECRET_${lookupSuffix}`];

    // Look for nonce baseline in .env using multiple naming conventions
    const envNonce = normalizeCredential(
      process.env[`RIG_NOUNCE_${lookupSuffix}`] ||
      process.env[`RIG_NONCE_${lookupSuffix}`] ||
      process.env[`RIG_${lookupSuffix}_NOUNCE`] ||
      process.env[`RIG_${lookupSuffix}_NONCE`] ||
      process.env[`MRR_NOUNCE_${lookupSuffix}`] ||
      process.env[`MRR_NONCE_${lookupSuffix}`]
    );

    if (envKey && envSecret) {
      config = {
        apiKey: normalizeCredential(envKey),
        apiSecret: normalizeCredential(envSecret),
      };
    }

    if (config?.apiKey && config?.apiSecret) {
      mrrInstances.set(clientName, config);
    }
  }

  const clientConfig = mrrInstances.get(clientName);
  if (!clientConfig) {
    // If we're aggregate, we shouldn't be resolving a config for 'VN' itself
    if (isAggregate(clientName)) return { clientName, clientConfig: null };

    const lookupSuffix = clientName;
    const envKey = process.env[`MRR_KEY_RIG_${lookupSuffix}`];
    const envSecret = process.env[`MRR_SECRET_RIG_${lookupSuffix}`];
    if (envKey && envSecret) {
       const cfg = { apiKey: normalizeCredential(envKey), apiSecret: normalizeCredential(envSecret) };
       mrrInstances.set(clientName, cfg);
       return { clientName, clientConfig: cfg };
    }
    
    const err = new Error(`MRR credentials missing for client "${clientName}". Ensure MRR_KEY_RIG_${lookupSuffix} is set.`);
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
  if (!mrrClockSynced) {
    await syncMrrClock();
  }

  const { clientName, clientConfig } = resolveMrrClient(clientNameRaw);
  return runMrrCallInOrder(clientName, async () => {
    const normalizedEndpoint = sanitizeMrrEndpoint(endpoint);
    const requestMethod = String(method || 'GET').toUpperCase();

    const hasBody = body !== undefined && body !== null && requestMethod !== 'GET' && requestMethod !== 'DELETE';
    const baseUrl = new URL(`https://www.miningrigrentals.com/api/v2${normalizedEndpoint}`);

    // Endpoint for signature: MRR expects the full path after /api/v2, including the leading slash.
    const sigEndpoint = normalizedEndpoint;
    // Strip tool-internal query parameters before forwarding to MRR
    const { client: _c, ts: _t, endpoint: _e, ...cleanQuery } = query || {};
    if (Object.keys(cleanQuery).length > 0) {
      for (const [key, value] of Object.entries(cleanQuery)) {
        if (value === undefined || value === null || value === '') continue;
        baseUrl.searchParams.set(key, String(value));
      }
    }

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
    let currentNonce = await nextMrrNonce(clientName);
    let signString = `${clientConfig.apiKey}${currentNonce}${sigEndpoint}`;
    const signatureV2 = createHmac('sha1', clientConfig.apiSecret).update(signString).digest('hex');

    let response = await send(currentNonce, signatureV2, {
      'x-api-key': clientConfig.apiKey,
      'x-api-nonce': currentNonce,
      'x-api-sign': signatureV2
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
    let isAuthFailureMessage = /signature|unauthorized|authenticated|invalid|missing api key/i.test(authMessage);
    const shouldRetry = (!data.success && isAuthFailureMessage) || response.statusCode === 401;

    if (shouldRetry) {
      console.warn(`[mrr:${clientName}] HMAC failed (${authMessage || 'Unauthorized'}), retrying with Legacy SHA1 Concatenation...`);
      currentNonce = await nextMrrNonce(clientName);
      const legacyStr = `${clientConfig.apiKey}${currentNonce}${sigEndpoint}${clientConfig.apiSecret}`;
      const legacySig = createHash('sha1').update(legacyStr).digest('hex');

      const retryRes = await send(currentNonce, legacySig, {
        'X-Api-Key': clientConfig.apiKey,
        'X-Api-Nonce': currentNonce,
        'X-Api-Sign': legacySig
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

    const logTime = new Date().toLocaleTimeString();
    console.log(`[${logTime}] [mrr:${clientName}] endpoint=${normalizedEndpoint} nonce=${currentNonce} status=${finalStatus} msg=${authMessage || 'OK'}`);

    return { statusCode: finalStatus, data, clientName };
  });
}

async function mrrRequest(endpoint, req, res, method = 'GET', body = undefined) {
  // Destructure to remove tool-internal parameters (client, endpoint, ts) from the forwarding query
  const { client: clientQuery, endpoint: _internalPath, ts: _ts, ...forwardQuery } = req.query || {};

  const targetClient = isAggregate(clientQuery) ? defaultMrrClient : clientQuery;

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

// Track offline counts per account to detect sudden increases
const lastOfflineCounts = new Map();
const lastAlertTimes = new Map(); // Tracks last alert timestamp per account

const ALERT_COOLDOWN_MS = 600000; // 10 minutes cooldown for same alert type
const WARNING_RIG_THRESHOLD = 5; // Alert if warning rigs exceed this
const RENTED_HEARTBEAT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Background monitor for MRR rentals. 
 * Saves state to SQLite and triggers Telegram notifications.
 * Returns a summary of actions taken.
 */
async function runRentalMonitor(forceNotify = false, clientScope = 'ALL') {
  const monitorTime = new Date().toLocaleTimeString();
  const requestedScope = String(clientScope || 'ALL').trim().toUpperCase();
  const allConfiguredAccts = Object.keys(mrrConfigs).filter(k => mrrConfigs[k].apiKey && mrrConfigs[k].apiSecret);
  const mrrAccts = isAggregate(requestedScope)
    ? allConfiguredAccts
    : allConfiguredAccts.filter(acct => acct === requestedScope);
  const now = Date.now();
  const notifications = [];

  const summaryParts = [];
  let totalAll = 0;
  let availableAll = 0;
  let rentedAll = 0;
  let offlineAll = 0;
  let disabledAll = 0;
  let warningAll = 0;
  const allRentedRigs = [];

  console.log(`[${monitorTime}] [monitor] Starting check for ${mrrAccts.length} accounts...`);

  for (const acct of mrrAccts) {
    try {
      const rigsRes = await mrrApiCall({ endpoint: '/rig/mine', clientNameRaw: acct });
      if (rigsRes.data?.success) {
        const rigList = Array.isArray(rigsRes.data.data) ? rigsRes.data.data : (rigsRes.data.data?.rigs || []);
        const total = rigList.length;

        const parseStatus = (rig) => String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toLowerCase();
        const rentedRigs = [];
        let availableCount = 0;
        let offlineCount = 0;
        let disabledCount = 0;
        let warningCount = 0;

        for (const rig of rigList) {
          const status = parseStatus(rig);
          const rentedFlag = Boolean(rig?.status?.rented);
          const onlineFlag = typeof rig?.status?.online === 'boolean' ? rig.status.online : Boolean(rig?.online);
          const isRented = rentedFlag || status.includes('rented') || status.includes('active');
          const isDisabled = status.includes('disabled');
          const isOffline = status.includes('offline') || !onlineFlag;
          const isWarning = status.includes('warning');
          const isAvailable = !isRented && !isDisabled && onlineFlag && (status.includes('available') || status.includes('online') || status === '');

          if (isRented) rentedRigs.push(rig);
          if (isAvailable) availableCount += 1;
          if (isOffline) offlineCount += 1;
          if (isDisabled) disabledCount += 1;
          if (isWarning) warningCount += 1;
        }

        const alertKeyWarn = `${acct}_warn`;
        const lastWarnAlert = lastAlertTimes.get(alertKeyWarn) || 0;
        if (warningCount >= WARNING_RIG_THRESHOLD && (now - lastWarnAlert > ALERT_COOLDOWN_MS)) {
          const warnMsg = `?? <b>[Status Alert: ${acct}]</b>\n\n` +
            `High number of rigs in warning state: <b>${warningCount}</b>\n` +
            `Please check your rig connectivity.`;
          await sendTelegramInternal(warnMsg).catch(e => console.error(`[monitor:error] Failed to send warning alert: ${e.message}`));
          lastAlertTimes.set(alertKeyWarn, now);
        }

        summaryParts.push(
          `?? <b>${acct}</b>: ${total} rigs (Avail: ${availableCount}, Rented: ${rentedRigs.length}, Offline: ${offlineCount}, Disabled: ${disabledCount}, Warn: ${warningCount})`
        );

        totalAll += total;
        availableAll += availableCount;
        rentedAll += rentedRigs.length;
        offlineAll += offlineCount;
        disabledAll += disabledCount;
        warningAll += warningCount;
        allRentedRigs.push(...rentedRigs.map(r => ({ ...r, acct })));
      }

      const { data } = await mrrApiCall({ endpoint: '/rental', clientNameRaw: acct });
      if (!data?.success) continue;

      const rentals = Array.isArray(data.data) ? data.data : (data.data?.rentals || []);

      for (const r of rentals) {
        const info = extractRentalInfo(r);
        const startTime = new Date(r.start + (String(r.start).endsWith('UTC') ? '' : ' UTC')).getTime();
        const endTime = new Date(r.end + (String(r.end).endsWith('UTC') ? '' : ' UTC')).getTime();

        const elapsedMs = now - startTime;
        const remainingMs = endTime - now;
        const totalDurationMs = endTime - startTime;

        const advertised = parseFloat(info.hashrate.advertised);
        const average = parseFloat(info.hashrate.average);
        const totalExpectedHashes = advertised * (totalDurationMs / 1000);
        const actualHashesDone = average * (elapsedMs / 1000);
        const remainingHashesNeeded = totalExpectedHashes - actualHashesDone;
        const requiredHashrate = remainingMs > 0 ? (remainingHashesNeeded / (remainingMs / 1000)) : 0;
        const displayTarget = requiredHashrate < 0 ? 0 : requiredHashrate;
        const efficiency = parseFloat(info.percent || 0);
        const currentHash = info.hashrate.current;

        const row = await new Promise((resolve) => {
          db.get(`SELECT last_notified, low_hashrate_start, zero_hashrate_start FROM rentals WHERE id = ?`, [String(r.id)], (err, row) => resolve(row));
        });

        let lowHashStart = row?.low_hashrate_start || 0;
        let zeroHashStart = row?.zero_hashrate_start || 0;

        if (efficiency < 50 && efficiency > 0) {
          if (lowHashStart === 0) lowHashStart = now;
          if (now - lowHashStart >= 900000) {
            const alertKey = `${r.id}_low_50`;
            const lastAlert = lastAlertTimes.get(alertKey) || 0;
            if (now - lastAlert > ALERT_COOLDOWN_MS) {
              const msg = `?? <b>[Performance Alert: ${acct}]</b>\n\n` +
                `Rig <b>${r.name || r.id}</b> is underperforming!\n` +
                `Efficiency: <b>${efficiency}%</b> (< 50% for 15m)`;
              await sendTelegramInternal(msg).catch(e => console.error(`[monitor:error] Low hashrate alert failed: ${e.message}`));
              console.log(`[${monitorTime}] [monitor] Sending Telegram alert: [Performance Alert] for Rig ${r.id}`);
              lastAlertTimes.set(alertKey, now);
            }
          }
        } else {
          lowHashStart = 0;
        }

        if (currentHash === 0) {
          if (zeroHashStart === 0) zeroHashStart = now;
          if (now - zeroHashStart >= 300000) {
            const alertKey = `${r.id}_zero_5m`;
            const lastAlert = lastAlertTimes.get(alertKey) || 0;
            if (now - lastAlert > ALERT_COOLDOWN_MS) {
              const msg = `?? <b>[Critical Alert: ${acct}]</b>\n\n` +
                `Rig <b>${r.name || r.id}</b> has ZERO hashrate!\n` +
                `Duration: <b>> 5 mins</b>`;
              await sendTelegramInternal(msg).catch(e => console.error(`[monitor:error] Zero hashrate alert failed: ${e.message}`));
              console.log(`[${monitorTime}] [monitor] Sending Telegram alert: [Critical Alert] for Rig ${r.id}`);
              lastAlertTimes.set(alertKey, now);
            }
          }
        } else {
          zeroHashStart = 0;
        }

        if (elapsedMs > 0 && elapsedMs < 3600000 && efficiency < 70 && efficiency > 0) {
          const startupKey = `${r.id}_startup_70`;
          const lastAlert = lastAlertTimes.get(startupKey) || 0;
          if (now - lastAlert > ALERT_COOLDOWN_MS) {
            const msg = `?? <b>[Startup Alert: ${acct}]</b>\n\n` +
              `Rig <b>${r.name || r.id}</b> startup efficiency is low!\n` +
              `Efficiency: <b>${efficiency}%</b> (< 70% in first hour)\n` +
              `Account: ${acct}`;
            console.log(`[${monitorTime}] [monitor] Sending Telegram alert: [Startup Alert] for Rig ${r.id}`);
            await sendTelegramInternal(msg).catch(e => console.error(`[monitor:error] Startup alert failed: ${e.message}`));
            lastAlertTimes.set(startupKey, now);
          }
        }

        await new Promise((resolve) => {
          db.run(`INSERT INTO rentals (id, name, client, algo, target_100, last_updated, low_hashrate_start, zero_hashrate_start) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET 
                  name=excluded.name, client=excluded.client, algo=excluded.algo, 
                  target_100=excluded.target_100, last_updated=excluded.last_updated,
                  low_hashrate_start=excluded.low_hashrate_start, zero_hashrate_start=excluded.zero_hashrate_start`,
            [String(r.id), r.name || r.id, acct, info.algo, requiredHashrate, now, lowHashStart, zeroHashStart],
            () => resolve()
          );
        });

        const lastNotified = row?.last_notified || 0;
        const isNewRental = lastNotified === 0;
        const shouldNotify = forceNotify || isNewRental;

        if (shouldNotify) {
          const remHours = Math.max(0, remainingMs / 3600000).toFixed(2);

          let hbType = forceNotify ? 'Forced Monitor' : 'New Rental';
          let icon = forceNotify ? '💓' : '🚀';

          const msg = `${icon} <b>[${hbType}]</b>\n\n` +
            `<b>Rig:</b> ${r.name || r.id}\n` +
            `<b>Algo:</b> ${info.algo}\n` +
            `<b>Current Avg:</b> ${info.niceAverageHashrate}\n` +
            `<b>Efficiency:</b> ${info.percent}%\n` +
            `<b>Paid:</b> ${info.price.paid} ${info.price.currency}\n` +
            `<b>Remaining:</b> ${remHours}h\n` +
            `<b>Target to 100%:</b> ${displayTarget.toFixed(2)} ${info.hashrate.suffix}\n` +
            `<b>Account:</b> ${acct}`;

          try {
            console.log(`[${monitorTime}] [monitor] Sending Telegram alert: ${hbType} for Rig ${r.id}`);
            const tgRes = await sendTelegramInternal(msg);
            await new Promise(res => db.run(`UPDATE rentals SET last_notified = ? WHERE id = ?`, [now, String(r.id)], () => res()));
            notifications.push({ id: r.id, status: 'Sent', telegram: tgRes });
          } catch (tgErr) {
            notifications.push({ id: r.id, status: 'Failed', error: tgErr.message });
          }
        } else {
          notifications.push({ id: r.id, status: 'Skipped', reason: 'Throttle (10m)' });
        }
      }
    } catch (err) {
      console.error(`[monitor:error] Client ${acct}: ${err.message}`);
    }
  }

  const shouldSendCombinedSummary = forceNotify || (now - (lastAlertTimes.get('global_summary') || 0) >= RENTED_HEARTBEAT_MS);
  if (shouldSendCombinedSummary && summaryParts.length > 0) {
    const allSummaryMsg = `📊 <b>[Current Rented Heartbeat - 15m]</b>\n\n` +
      summaryParts.join('\n') +
      `\n\n<b>Totals</b>: ${totalAll} rigs | ${availableAll} Avail | ${rentedAll} Rented | ${offlineAll} Offline | ${disabledAll} Disabled | ${warningAll} Warn` +
      (allRentedRigs.length > 0 ? `\n\n<b>Active Rentals:</b>\n${allRentedRigs.map(r => `- [${r.acct}] ${r.name || r.id}`).join('\n')}` : '');

    try {
      await sendTelegramInternal(allSummaryMsg);
      lastAlertTimes.set('global_summary', now);
    } catch (e) {
      console.error(`[monitor:error] Failed to send ALL summary: ${e.message}`);
    }
  }

  return {
    notifications,
    summary: {
      scope: requestedScope,
      accounts: mrrAccts,
      totals: {
        rigs: totalAll,
        available: availableAll,
        rented: rentedAll,
        offline: offlineAll,
        disabled: disabledAll,
        warning: warningAll
      },
      perAccount: summaryParts,
      activeRentals: allRentedRigs.map(r => ({ account: r.acct, id: r.id, name: r.name || r.id }))
    }
  };
}
/** Internal Telegram Sender */
async function sendTelegramInternal(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.warn('[telegram] Telegram credentials missing. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env');
    throw new Error('Telegram credentials missing');
  }
  const text = String(message || '').trim();
  if (!text) throw new Error('Telegram message is empty');

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await request(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        headersTimeout: 8000,
        bodyTimeout: 8000
      });

      const data = await res.body.json();
      if (res.statusCode >= 200 && res.statusCode < 300 && data?.ok) return data;

      const reason = data?.description || `HTTP ${res.statusCode}`;
      throw new Error(`Telegram API rejected message: ${reason}`);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 300));
      }
    }
  }
  throw lastError || new Error('Telegram send failed');
}

// Trigger monitor and return details
app.post('/api/v2/mrr/monitor/run', asyncHandler(async (req, res) => {
  const scope = String(req.query.client || req.body?.client || 'ALL').trim().toUpperCase();
  const result = await runRentalMonitor(true, scope);
  res.json({ success: true, ...result });
}));

// Test endpoint for the "New Rental" notice formatting
app.post('/api/v2/test/rented-notice', asyncHandler(async (req, res) => {
  const msg = `🚀 <b>[New Rental] (Test)</b>\n\n` +
    `<b>Rig:</b> Test-Rig-Notice\n` +
    `<b>Algo:</b> SHA256\n` +
    `<b>Current Avg:</b> 1.23 TH/s\n` +
    `<b>Efficiency:</b> 100.0%\n` +
    `<b>Paid:</b> 0.00045000 BTC\n` +
    `<b>Remaining:</b> 24.00h\n` +
    `<b>Target to 100%:</b> 1.23 TH/s\n` +
    `<b>Account:</b> TEST_BT`;

  try {
    const tgRes = await sendTelegramInternal(msg);
    res.json({ success: true, message: 'Test notice sent', telegram: tgRes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}));

// Fetch current database state
app.get('/api/v2/mrr/monitor/snapshot', asyncHandler(async (req, res) => {
  db.all(`SELECT * FROM rentals ORDER BY last_updated DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, data: rows });
  });
}));

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

  const priceObj = rental.price || rental.rig?.price || {};
  const currency = priceObj.currency || rental.currency || rental.price_unit || 'BTC';

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
    price: {
      paid: priceObj.paid || '0.00',
      advertised: priceObj.advertised || '0.00',
      currency: currency
    },
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
        const poolPortFromHost = (poolHost.match(/:(\d+)$/) || [])[1];
        const poolPort = Number(pool.port || pool.stratumPort || poolPortFromHost || null);

        if (poolAlgo && poolHost && poolUser && poolPass && Number.isFinite(poolPort)) {
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

  if (isAggregate(clientParam)) {
    const allClientNames = Object.keys(mrrConfigs).filter(c => mrrConfigs[c].apiKey && mrrConfigs[c].apiSecret && !isAggregate(c));
    const allRigs = [];
    const errors = [];

    for (const clientName of allClientNames) {
      try {
        const { data, statusCode } = await mrrApiCall({ endpoint: targetEndpoint, clientNameRaw: clientName });
        let rigs = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.data?.rigs) ? data.data.rigs : []);

        // Merge pool info for personal rigs in bulk
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
    // Merge pool info automatically for personal rigs (single client)
    if (targetEndpoint === '/rig/mine') {
      const { data, statusCode, clientName } = await mrrApiCall({ endpoint: '/rig/mine', clientNameRaw: clientParam });
      if (statusCode === 200 && data.success) {
        const rigs = Array.isArray(data.data) ? data.data : (data.data?.rigs || []);
        if (rigs.length > 0) {
          // Identify rigs needing pool info
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

/**
 * Aggregated endpoint to fetch pools for all rigs owned by the user.
 */
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

  // Single client logic
  const { data: rigsData, clientName } = await mrrApiCall({
    endpoint: '/rig/mine',
    clientNameRaw: clientParam,
  });

  const rigs = Array.isArray(rigsData?.data) ? rigsData.data : (Array.isArray(rigsData?.data?.rigs) ? rigsData.data.rigs : []);

  if (!rigsData?.success || rigs.length === 0) {
    res.set('X-MRR-Client', clientName);
    return res.json(rigsData || { success: true, data: [] });
  }

  const rigIds = rigs.map(r => r.id).join(';');
  const { statusCode, data } = await mrrApiCall({
    endpoint: `/rig/${rigIds}/pool`,
    clientNameRaw: clientName,
  });

  res.set('X-MRR-Client', clientName);
  res.status(statusCode).json(data);
}));

app.get('/api/v2/mrr/balance', asyncHandler(async (req, res) => mrrRequest('/account/balance', req, res)));
app.get('/api/v2/mrr/algos', asyncHandler(async (req, res) => mrrRequest('/info/algos', req, res)));
app.get('/api/v2/mrr/profiles', asyncHandler(async (req, res) => mrrRequest('/profile', req, res)));

/**
 * Price comparison endpoint between MRR marketplace and NiceHash.
 * Fetches available rigs and enriches them with NiceHash market prices.
 */
app.get('/api/v2/mrr/compare', asyncHandler(async (req, res) => {
  const clientParam = String(req.query.client || defaultMrrClient).toUpperCase();
  const algoParam = req.query.algorithm || req.query.algo;

  const { data: mrrData } = await mrrApiCall({
    endpoint: '/rig',
    query: { algo: algoParam },
    clientNameRaw: clientParam
  });

  const rigs = Array.isArray(mrrData?.data?.rigs) ? mrrData.data.rigs :
    Array.isArray(mrrData?.data) ? mrrData.data : [];

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
        id: r.id, name: r.name, algo: r.algo || r.type,
        price: r.price || r.min_price || '0', currency: r.price_unit || 'BTC',
        hashrate_unit: r.hashrate_unit || 'TH'
      },
      nicehashPrice: priceMap.get(a) || null
    };
  });
  res.json({ success: true, data: comparison });
}));

/** Reusable logic for fetching rentals (current or history) with merged pool info */
async function fetchAggregatedRentals(query = {}, clientParam = 'BT') {
  const isAll = isAggregate(clientParam);
  const allClientNames = isAll
    ? Object.keys(mrrConfigs).filter(c => mrrConfigs[c].apiKey && mrrConfigs[c].apiSecret && !isAggregate(c))
    : [clientParam];

  const allRentals = [];
  const errors = [];

  // Clean query for MRR (remove tool-internal params)
  const { ts: _t, client: _c, ...mrrQuery } = query || {};

  for (const clientName of allClientNames) {
    try {
      const { data, statusCode } = await mrrApiCall({ endpoint: '/rental', method: 'GET', clientNameRaw: clientName, query: mrrQuery });
      if (statusCode === 200 && data.success) {
        const rentals = Array.isArray(data.data) ? data.data : (data.data?.rentals || []);
        if (rentals.length > 0) {
          rentals.forEach(r => r.mrrClient = clientName);
          const rentalIds = rentals.map(r => r.id).join(';');
          const { data: poolsData } = await mrrApiCall({ endpoint: `/rental/${rentalIds}/pool`, clientNameRaw: clientName });
          if (poolsData && poolsData.success) {
            const poolItems = Array.isArray(poolsData.data) ? poolsData.data : (poolsData.data?.result || poolsData.data?.rentals || []);
            const poolMap = new Map(poolItems.map(item => [String(item.rigid || item.id || item.rentalid || item.rental_id || item.rental_id), item.pools]));
            rentals.forEach(r => {
              const pools = poolMap.get(String(r.id));
              if (pools && pools.length > 0) {
                const p0 = pools.find(p => p.priority === 0 || p.priority === '0') || pools[0];
                r.host = p0.host || p0.stratumHost; r.port = p0.port || p0.stratumPort; r.user = p0.user || p0.username;
              }
            });
          }
          allRentals.push(...rentals);
        }
      } else if (!isAll) {
        return { statusCode, data, clientName }; // Return raw error for single client
      }
    } catch (err) { if (!isAll) throw err; errors.push({ client: clientName, message: err.message }); }
  }
  return { statusCode: 200, data: { success: true, data: { rentals: allRentals }, errors: errors.length > 0 ? errors : undefined }, clientName: isAll ? 'ALL' : clientParam };
}

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

      // Enrich with NiceHash Market Price comparison
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

      // Enrich with NiceHash Market Price comparison
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

// --- NOTIFICATIONS --- 
app.post('/api/v2/notify/zalo', asyncHandler(async (req, res) => {
  const { message } = req.body;
  const accessToken = process.env.ZALO_ACCESS_TOKEN;
  const userUID = process.env.ZALO_USER_UID;

  if (!accessToken || !userUID) {
    console.warn('[zalo] Configuration missing. Please set ZALO_ACCESS_TOKEN and ZALO_USER_UID in .env');
    return res.status(400).json({ success: false, message: 'Zalo configuration missing in server .env' });
  }

  const response = await request('https://openapi.zalo.me/v2.0/oa/message', {
    method: 'POST',
    headers: {
      'access_token': accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      recipient: { user_id: userUID },
      message: { text: message }
    })
  });

  const data = await response.body.json();
  res.json(data);
}));

// Telegram Notifications
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

// Telegram notifier health/debug endpoint
app.get('/api/v2/notify/telegram/health', asyncHandler(async (req, res) => {
  const hasToken = !!process.env.TELEGRAM_BOT_TOKEN;
  const hasChatId = !!process.env.TELEGRAM_CHAT_ID;
  res.json({
    success: hasToken && hasChatId,
    configured: hasToken && hasChatId,
    tokenPresent: hasToken,
    chatIdPresent: hasChatId
  });
}));

// --- SERVE FRONTEND ---
// Serve static files from the 'dist' directory (created by npm run build)
const distPath = path.join(__dirname, 'dist', 'client');
app.use(express.static(distPath));

// Catch-all route to serve the React app for any non-API request
app.get(/.*/, (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not Found' });
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
 * Clears persistent state to ensure a fresh synchronization on startup.
 */
async function cleanAllCache() {
  console.info('[init] Cleaning all cached data (SQLite rentals & database.json)...');
  try {
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM rentals`, (err) => err ? reject(err) : resolve());
    });
    try {
      await fs.unlink(DB_FILE);
    } catch (e) { /* Ignore if file missing */ }
    console.info('✨ Cache cleared successfully.');
  } catch (err) {
    console.error(`[init] Failed to clean cache: ${err.message}`);
  }
}

/**
 * Keep logic for local execution if needed
 */
if (process.env.RUN_MAIN !== 'false') {
  // Always clear cache and initialize nonces/clock on startup
  cleanAllCache();

  initNonces().then(() => {
    syncMrrClock().then(() => {
      syncManager.run(); // Background sync

      // Initialize Monitor Loop (Every 1 minute)
      setInterval(() => runRentalMonitor(), 60000);
      // Run once immediately
      runRentalMonitor();
    });
  });

  // Separate Connectivity check for NiceHash (wont block monitor)
  try {
    const { client } = resolveNhClient('BT');
    if (client) {
      getNiceHashApp(client).public.getTime().then((t) => {
        console.log('✅ Connection verified. Server Time:', new Date(t).toLocaleString());
      }).catch(e => console.warn('⚠️ NiceHash connectivity check failed on start:', e.message));
    }
  } catch (error) { console.error('❌ Initialization Error:', error.message); }
}
function normalizeCredential(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^['"]|['"]$/g, '').trim();
}

