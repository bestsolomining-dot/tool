import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import 'dotenv/config';
// Note: NiceHashClient must be updated to use fetch() instead of undici/axios for Workers
import { NiceHashClient } from './NiceHashClient.js'; 

const app = new Hono();

// --- LOGGING ---
app.use('*', logger());

// --- CORS ---
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposeHeaders: ['Retry-After', 'X-RateLimit-Limit'],
}));

// --- AUTHENTICATION ---
app.post('/api/login', async (c) => {
  return c.json({ success: true, token: 'bypass' });
});

app.get('/api/config-status', (c) => {
  const env = c.env || process.env;
  return c.json({
    nicehash: !!(env.NICEHASH_API_KEY && env.NICEHASH_API_SECRET),
    envLoaded: true
  });
});

let nhInstance = null;
function resolveNhClient(env) {
  if (nhInstance) return nhInstance;
  const apiKey = env?.NICEHASH_API_KEY || process.env.NICEHASH_API_KEY;
  const apiSecret = env?.NICEHASH_API_SECRET || process.env.NICEHASH_API_SECRET;
  const orgId = env?.NICEHASH_ORG_ID || process.env.NICEHASH_ORG_ID;
  if (!apiKey || !apiSecret || !orgId) {
    throw new Error('NiceHash credentials missing.');
  }
  nhInstance = new NiceHashClient({
    apiKey, apiSecret, orgId,
    environment: env?.NICEHASH_ENVIRONMENT || process.env.NICEHASH_ENVIRONMENT || 'production'
  });
  return nhInstance;
}

const NiceHashApp = {
  public: {
    getTime: (nh) => nh.getServerTime(),
    getAlgorithms: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/algorithms' }),
    getMarkets: (nh) => nh.call({ method: 'GET', path: '/main/api/v2/mining/markets' }),
  },
  pools: {
    getPools: (nh, query) => nh.call({ method: 'GET', path: '/main/api/v2/pools', query }),
    getPoolDetails: (nh, poolId) => nh.call({ method: 'GET', path: `/main/api/v2/pool/${poolId}` }),
    verifyPool: (nh, body) => nh.call({ method: 'POST', path: '/main/api/v2/pools/verify', body }),
  },
  hashpower: {
    getMyOrders: (nh, query) => nh.call({ method: 'GET', path: '/main/api/v2/hashpower/myOrders', query }),
  }
};

// Route Handlers
app.get('/api/v2/time', async (c) => c.json(await NiceHashApp.public.getTime(resolveNhClient(c.env || process.env))));
app.get('/api/v2/algorithms', async (c) => c.json(await NiceHashApp.public.getAlgorithms(resolveNhClient(c.env || process.env))));
app.get('/api/v2/mining/markets', async (c) => c.json(await NiceHashApp.public.getMarkets(resolveNhClient(c.env || process.env))));

app.get('/api/v2/pools', async (c) => {
  const nh = resolveNhClient(c.env || process.env);
  return c.json(await NiceHashApp.pools.getPools(nh, c.req.query()));
});

app.get('/api/v2/pool/:poolId', async (c) => {
  const nh = resolveNhClient(c.env || process.env);
  return c.json(await NiceHashApp.pools.getPoolDetails(nh, c.req.param('poolId')));
});

app.post('/api/v2/pools/verify', async (c) => {
  const nh = resolveNhClient(c.env || process.env);
  const body = await c.req.json();
  return c.json(await NiceHashApp.pools.verifyPool(nh, body));
});

app.get('/api/v2/hashpower/myOrders', async (c) => {
  const nh = resolveNhClient(c.env || process.env);
  return c.json(await NiceHashApp.hashpower.getMyOrders(nh, c.req.query()));
});

app.onError((err, c) => {
  const status = err.statusCode || 500;
  console.error(`[Backend Error] ${status}: ${err.message}`);
  
  if (status === 429 && err.headers) {
    const retryAfter = typeof err.headers.get === 'function' 
      ? err.headers.get('retry-after') 
      : err.headers['retry-after'];
    if (retryAfter) c.header('Retry-After', retryAfter);
  }

  return c.json({ error: err.message }, status);
});

if (typeof process !== 'undefined' && process.release?.name === 'node') {
  const port = 3000;
  console.log(`\n🚀 Backend proxy running at http://localhost:${port}`);
  serve({
    fetch: app.fetch,
    port,
  });
}

export default app;
