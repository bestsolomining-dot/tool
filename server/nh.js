import { NiceHashClient } from '../NiceHashClient.js';
import { mapNiceHashToMRR, normalizeAlgoForNiceHash } from '../src/core/mapping.js';
import { normalizeCredential } from './utils.js';
import { db } from './db.js';

export const AGGREGATE_CLIENT = 'VN';
const poolCache = new Map();
const publicCache = new Map();
const POOL_CACHE_TTL = 60000; // 1 minute cache
const NH_CACHE_TTL_DEFAULT = 30000; // 30 seconds
const NH_CACHE_TTL_STABLE = 300000; // 5 minutes
const nhInflight = new Map();

/** Normalizes market strings (USA/EU) to NiceHash numeric IDs (1/0) */
export function normalizeMarket(market) {
  if (typeof market === 'number') return String(Math.floor(market));
  if (market === '1' || market === '0') return market;
  if (!isNaN(Number(market)) && market !== null && market !== '') return String(Number(market));
  const m = String(market || '0').toUpperCase().trim();
  if (m === 'USA' || m === 'AMERICA' || m === 'US') return '1';
  if (m === 'EU' || m === 'EUROPE') return '0';
  return m;
}

export { mapNiceHashToMRR, normalizeAlgoForNiceHash }; // Keep these exports

export let nhConfigs = {}; // Declare as mutable

export function initNhConfigs(env) {
  nhConfigs = {
    BT: {
      apiKey: normalizeCredential(env.NICEHASH_API_KEY),
      apiSecret: normalizeCredential(env.NICEHASH_API_SECRET),
      orgId: normalizeCredential(env.NICEHASH_ORG_ID),
      environment: normalizeCredential(env.NICEHASH_ENVIRONMENT || 'production'),
    },
    PH: {
      apiKey: normalizeCredential(env.NICEHASH_API_KEY_PH),
      apiSecret: normalizeCredential(env.NICEHASH_API_SECRET_PH),
      orgId: normalizeCredential(env.NICEHASH_ORG_ID_PH),
      environment: normalizeCredential(env.NICEHASH_ENVIRONMENT || 'production'),

    },
    KIMLOAN: {
      apiKey: normalizeCredential(env.NICEHASH_API_KEY_KIMLOAN),
      apiSecret: normalizeCredential(env.NICEHASH_API_SECRET_KIMLOAN),
      orgId: normalizeCredential(env.NICEHASH_ORG_ID_KIMLOAN),
      environment: normalizeCredential(env.NICEHASH_ENVIRONMENT || 'production'),

    },
    NHATLINH: {
      apiKey: normalizeCredential(env.NICEHASH_API_KEY_NHATLINH),
      apiSecret: normalizeCredential(env.NICEHASH_API_SECRET_NHATLINH),
      orgId: normalizeCredential(env.NICEHASH_ORG_ID_NHATLINH),
      environment: normalizeCredential(env.NICEHASH_ENVIRONMENT || 'production'),
    },
  };

  // Discover and register additional accounts from environment variables
  Object.keys(env).forEach(key => {
    if (key.startsWith('NICEHASH_API_KEY_')) {
      const acct = key.replace('NICEHASH_API_KEY_', '').toUpperCase();
      if (!nhConfigs[acct]) {
        nhConfigs[acct] = {
          apiKey: normalizeCredential(env[key]),
          apiSecret: normalizeCredential(env[`NICEHASH_API_SECRET_${acct}`]),
          orgId: normalizeCredential(env[`NICEHASH_ORG_ID_${acct}`] || env.NICEHASH_ORG_ID),
          environment: normalizeCredential(env[`NICEHASH_ENVIRONMENT_${acct}`] || env.NICEHASH_ENVIRONMENT || 'production'),
        };
      }
    }
  });
}

export const isAggregate = (c) => {
  const uc = String(c || '').trim().toUpperCase();
  return uc === 'ALL' || uc === AGGREGATE_CLIENT;
};

export function resolveNhClient(clientNameRaw) {
  const clientName = isAggregate(clientNameRaw) ? AGGREGATE_CLIENT : String(clientNameRaw || 'BT').trim().toUpperCase();

  // 1. Handle Aggregate (VN) resolution
  if (isAggregate(clientName)) {
    const btProvider = resolveNhClient('BT');
    return { client: btProvider.client, clientName: AGGREGATE_CLIENT };
  }

  // 2. Return cached instance
  if (nhInstances.has(clientName)) {
    return { client: nhInstances.get(clientName), clientName };
  }

  // 3. Initialize from config
  const cfg = nhConfigs[clientName];
  if (cfg?.apiKey && cfg?.apiSecret && cfg?.orgId) {
    const newClient = new NiceHashClient({ ...cfg, name: clientName });
    nhInstances.set(clientName, newClient);
    return { client: newClient, clientName };
  }

  // 4. Recursive fallback to BT if client is unconfigured
  if (clientName !== 'BT') {
    console.warn(`[nh:resolve] Client "${clientName}" not found or unconfigured. Falling back to BT.`);
    return resolveNhClient('BT');
  }

  return { client: undefined, clientName: 'BT' };
}

/**
 * Internal helper to call NiceHash API with caching for public/static endpoints.
 */
async function cachedCall(client, options) {
  const isGet = options.method === 'GET';
  const isPublic = options.path.includes('/public/') || options.path.includes('/mining/algorithms') || options.path.includes('/mining/markets');
  
  if (isGet && isPublic) {
    const cacheKey = `${options.path}:${JSON.stringify(options.query || {})}`;
    const cached = publicCache.get(cacheKey);
    const ttl = (options.path.includes('algorithms') || options.path.includes('markets')) ? NH_CACHE_TTL_STABLE : NH_CACHE_TTL_DEFAULT;
    
    if (cached && (Date.now() - cached.ts < ttl)) {
      return cached.data;
    }

    if (nhInflight.has(cacheKey)) return nhInflight.get(cacheKey);

    const promise = client.call(options).then(data => {
      if (data && !data.error) {
        publicCache.set(cacheKey, { data, ts: Date.now() });
      }
      return data;
    }).finally(() => {
      nhInflight.delete(cacheKey);
    });

    nhInflight.set(cacheKey, promise);
    return promise;
  }

  return client.call(options);
}

/** Fetches and caches NiceHash pools to prevent API hammering */
export async function getCachedNhPools(clientNameRaw) {
  const { client, clientName } = resolveNhClient(clientNameRaw);
  if (!client) return [];

  const cached = poolCache.get(clientName);
  if (cached && (Date.now() - cached.ts < POOL_CACHE_TTL)) {
    return cached.pools;
  }

  try {
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
    poolCache.set(clientName, { pools: allPools, ts: Date.now() });

    // Persistence: Sync fetched NiceHash pools to database
    if (allPools.length > 0) {
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS nh_pools (
          id TEXT,
          name TEXT,
          algorithm TEXT,
          stratumHostname TEXT,
          port TEXT,
          username TEXT,
          password TEXT,
          nhClient TEXT,
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id, nhClient)
        )`);
        const stmt = db.prepare(`INSERT OR REPLACE INTO nh_pools 
          (id, name, algorithm, stratumHostname, port, username, password, nhClient, last_updated) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
        allPools.forEach(p => {
          stmt.run(p.id, p.name, p.algorithm, p.stratumHostname, p.port, p.username, p.password, clientName);
        });
        stmt.finalize();
      });
    }

    return allPools;
  } catch (e) {
    console.warn(`[nh:pools] Cache fetch failed for ${clientName}:`, e.message);
    return cached ? cached.pools : []; // Fallback to stale data if available
  }
}

const nhInstances = new Map();

export const getNiceHashApp = (client) => ({
  public: {
    getTime: () => client.getServerTime(),
    getDoc: () => cachedCall(client, { method: 'GET', path: '/api/v2/doc' }),
    getAlgorithms: () => cachedCall(client, { method: 'GET', path: '/main/api/v2/mining/algorithms' }),
    getMarkets: () => cachedCall(client, { method: 'GET', path: '/main/api/v2/mining/markets' }),
    getCurrencies: () => cachedCall(client, { method: 'GET', path: '/main/api/v2/public/currencies' }),
    getNetworks: () => client.call({ method: 'GET', path: '/main/api/v2/public/networks' }),
    getFeeInfo: () => client.call({ method: 'GET', path: '/main/api/v2/public/service/fee/info' }),
    getCountries: () => client.call({ method: 'GET', path: '/api/v2/enum/countries' }),
    getOrgIndustry: () => client.call({ method: 'GET', path: '/api/v2/enum/organisationIndustry' }),
    getPermissions: () => client.call({ method: 'GET', path: '/api/v2/enum/permissions' }),
    getXchCountries: () => client.call({ method: 'GET', path: '/api/v2/enum/xchCountries' }),
    getSystemFlags: () => client.call({ method: 'GET', path: '/api/v2/system/flags' }),
  },
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
    cancelWithdrawal: (currency, id) => client.call({ method: 'DELETE', path: `/main/api/v2/accounting/withdrawal/${currency}/${id}`, query: { ts: Date.now().toString() } }),
    getWithdrawalDetail: (currency, id) => client.call({ method: 'GET', path: `/main/api/v2/accounting/withdrawal2/${currency}/${id}`, query: { ts: Date.now().toString() } }),
    getWithdrawalAddress: (id) => client.call({ method: 'GET', path: `/main/api/v2/accounting/withdrawalAddress/${id}`, query: { ts: Date.now().toString() } }),
    getWithdrawalAddresses: () => client.call({ method: 'GET', path: '/main/api/v2/accounting/withdrawalAddresses', query: { ts: Date.now().toString() } }),
    getWithdrawals: (currency) => client.call({ method: 'GET', path: `/main/api/v2/accounting/withdrawals/${currency}`, query: { ts: Date.now().toString() } }),
  },
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
  hashpower: {
    getBusinessBuyerStats: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/business/buyer/stats' }),
    getBusinessBuyerInfo: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/business/buyers/info' }),
    getMyOrders: (query) => client.call({ method: 'GET', path: '/main/api/v2/hashpower/myOrders', query: { orgId: client.orgId, ...query } }),
    createOrder: (orderData) => client.call({ method: 'POST', path: '/main/api/v2/hashpower/order', body: orderData, query: { orgId: client.orgId } }),
    getOrderDetail: (orderId) => client.call({ method: 'GET', path: `/main/api/v2/hashpower/order/${orderId}`, query: { ts: Date.now().toString() } }),
    cancelOrder: (orderId) => client.call({ method: 'DELETE', path: `/main/api/v2/hashpower/order/${orderId}`, query: { orgId: client.orgId } }),
    refillOrder: (orderId, body) => client.call({ method: 'POST', path: `/main/api/v2/hashpower/order/${orderId}/refill`, body, query: { orgId: client.orgId } }),
    updatePriceLimit: (orderId, body) => client.call({ method: 'POST', path: `/main/api/v2/hashpower/order/${orderId}/updatePriceAndLimit`, body, query: { orgId: client.orgId } }),
    getVmmOrders: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/vmm/orders' }),
    getOrderPrice: (query) => {
      const { algorithm, market, amount, limit, ...rest } = query || {};
      // Ensure all required fields for /order/calculate are present
      // Increased default amount to 0.01 to satisfy minimums for heavier algorithms
      const finalAmount = amount || limit || '0.01';
      const finalAlgo = normalizeAlgoForNiceHash(algorithm);
      const finalMarket = normalizeMarket(market || 'USA');

      return client.call({
        method: 'GET',
        path: '/main/api/v2/hashpower/order/calculate',
        query: {
          ...rest,
          algorithm: finalAlgo,
          market: finalMarket,
          amount: finalAmount
        }
      });
    },
    getBusinessOrder: (query) => {
      const { algorithm, market, client: _c, ts: _t, ...rest } = query || {};
      const amount = rest.amount || '0.001';
      return client.call({
        method: 'GET',
        path: '/main/api/v2/hashpower/order/calculate',
        query: {
          ...rest,
          algorithm: normalizeAlgoForNiceHash(algorithm),
          market: normalizeMarket(market),
          amount
        }
      });
    },
    getOrderBook: (query) => {
      const { algorithm, market, client: _c, ts: _t, ...rest } = query || {};
      return client.call({
        method: 'GET',
        path: '/main/api/v2/hashpower/orderBook',
        query: { 
          ...rest,
          algorithm: normalizeAlgoForNiceHash(algorithm),
          market: normalizeMarket(market)
        }
      });
    },
    getGlobalStats24h: () => client.call({ method: 'GET', path: '/main/api/v2/public/stats/global/24h' }),
  },
  easyMining: {
    getMassBuyConfigs: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/easymining/massbuy/configurations', query: { ts: Date.now().toString() } }),
    getSoloOrders: () => client.call({ method: 'GET', path: '/main/api/v2/hashpower/solo/order', query: { ts: Date.now().toString() } }),
    buySoloPackage: (body) => client.call({ method: 'POST', path: '/main/api/v2/hashpower/solo/order', body }),
    getCurrencyAlgos: () => client.call({ method: 'GET', path: '/main/api/v2/public/currency-algos' }),
    getPackages: () => client.call({ method: 'GET', path: '/main/api/v2/public/easymining/packages' }),
  },
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
  },
});
