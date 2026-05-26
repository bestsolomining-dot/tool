import 'dotenv/config';
import express from 'express';
import { NiceHashClient } from './NiceHashClient.js';

const app = express();
app.use(express.json());

/**
 * NiceHashApp organizes API calls into logical domains.
 */
const config = {
  apiKey: process.env.NICEHASH_API_KEY,
  apiSecret: process.env.NICEHASH_API_SECRET,
  orgId: process.env.NICEHASH_ORG_ID,
  environment: process.env.NICEHASH_ENVIRONMENT || 'production'
};

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

// Public
app.get('/api/time', async (req, res) => res.json(await NiceHashApp.public.getTime()));
app.get('/api/algorithms', async (req, res) => res.json(await NiceHashApp.public.getAlgorithms()));

// Accounting
app.get('/api/accounting/balances', async (req, res) => res.json(await NiceHashApp.accounting.getBalances()));
app.get('/api/accounting/balance/:currency', async (req, res) => res.json(await NiceHashApp.accounting.getBalance(req.params.currency)));
app.post('/api/accounting/withdrawal', async (req, res) => res.json(await NiceHashApp.accounting.createWithdrawal(req.body)));

// Mining
app.get('/api/mining/rigs', async (req, res) => res.json(await NiceHashApp.mining.getRigs()));
app.get('/api/mining/rig/:rigId', async (req, res) => res.json(await NiceHashApp.mining.getRigDetails(req.params.rigId)));
app.post('/api/mining/rigs/status', async (req, res) => res.json(await NiceHashApp.mining.setRigStatus(req.body)));

// Hashpower
app.get('/api/hashpower/my-orders', async (req, res) => res.json(await NiceHashApp.hashpower.getMyOrders()));
app.post('/api/hashpower/order', async (req, res) => res.json(await NiceHashApp.hashpower.createOrder(req.body)));
app.get('/api/hashpower/order-book', async (req, res) => res.json(await NiceHashApp.hashpower.getOrderBook(req.query)));

// Pools
app.get('/api/pools', async (req, res) => res.json(await NiceHashApp.pools.getPools()));
app.post('/api/pool', async (req, res) => res.json(await NiceHashApp.pools.createPool(req.body)));

// Error handling wrapper for Express
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(err => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });
};

// Example: Applying the wrapper to one route
app.get('/api/mining/address', asyncHandler(async (req, res) => {
  const data = await NiceHashApp.mining.getMiningAddress();
  res.json(data);
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`--- NiceHash API Toolbox Server Started ---`);
  console.log(`Environment: ${config.environment.toUpperCase()}`);
  console.log(`Listening on http://localhost:${PORT}`);
});

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