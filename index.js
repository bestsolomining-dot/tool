import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import 'dotenv/config';
// Note: NiceHashClient must be updated to use fetch() instead of undici/axios for Workers
import { NiceHashClient } from './NiceHashClient.js'; 

const app = new Hono();

// --- CORS ---
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposeHeaders: ['Retry-After', 'X-RateLimit-Limit'],
}));

// --- AUTHENTICATION ---
app.post('/api/login', async (c) => {
  const { password } = await c.req.json();
  const securePassword = c.env.APP_PASSWORD || 'admin123';
  if (password === securePassword) {
    return c.json({ success: true, token: 'session_' + Math.random().toString(36).slice(2) });
  }
  return c.json({ error: 'Invalid password' }, 401);
});

// Workers are stateless; writing to .env with fs.writeFile is not possible.
// You should use Cloudflare KV or Secrets to update configuration.
app.post('/api/update-config', async (c) => {
  return c.json({ error: 'Runtime config updates require Cloudflare KV setup.' }, 501);
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
  console.error(err);
  return c.json({ error: err.message }, 500);
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
