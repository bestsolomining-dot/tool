import { Hono } from 'hono';
import { cors } from 'hono/cors';
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
  return c.json({
    nicehash: !!(c.env.NICEHASH_API_KEY && c.env.NICEHASH_API_SECRET),
    envLoaded: true
  });
});

let nhInstance = null;
function resolveNhClient(env) {
  if (nhInstance) return nhInstance;
  const apiKey = env.NICEHASH_API_KEY;
  const apiSecret = env.NICEHASH_API_SECRET;
  const orgId = env.NICEHASH_ORG_ID;
  if (!apiKey || !apiSecret || !orgId) {
    throw new Error('NiceHash credentials missing.');
  }
  nhInstance = new NiceHashClient({
    apiKey, apiSecret, orgId,
    environment: env.NICEHASH_ENVIRONMENT || 'production'
  });
  return nhInstance;
}

const NiceHashApp = {
  public: {
    getTime: (nh) => nh.public.getServerTime(),
    getAlgorithms: (nh) => nh.public.getAlgorithms(),
    getMarkets: (nh) => nh.public.getMarkets(),
  },
  pools: {
    getPools: (nh, query) => nh.pools.getPools(query),
    getPoolDetails: (nh, poolId) => nh.pools.getPoolDetails(poolId),
    verifyPool: (nh, body) => nh.pools.verifyPool(body),
  },
  hashpower: {
    getMyOrders: (nh, query) => nh.hashpower.getMyOrders(query),
  }
};

// Route Handlers
app.get('/api/v2/time', async (c) => c.json(await NiceHashApp.public.getTime(resolveNhClient(c.env))));
app.get('/api/v2/algorithms', async (c) => c.json(await NiceHashApp.public.getAlgorithms(resolveNhClient(c.env))));
app.get('/api/v2/mining/markets', async (c) => c.json(await NiceHashApp.public.getMarkets(resolveNhClient(c.env))));

app.get('/api/v2/pools', async (c) => {
  const nh = resolveNhClient(c.env);
  return c.json(await NiceHashApp.pools.getPools(nh, c.req.query()));
});

app.get('/api/v2/pool/:poolId', async (c) => {
  const nh = resolveNhClient(c.env);
  return c.json(await NiceHashApp.pools.getPoolDetails(nh, c.req.param('poolId')));
});

app.post('/api/v2/pools/verify', async (c) => {
  const nh = resolveNhClient(c.env);
  const body = await c.req.json();
  return c.json(await NiceHashApp.pools.verifyPool(nh, body));
});

app.get('/api/v2/hashpower/myOrders', async (c) => {
  const nh = resolveNhClient(c.env);
  return c.json(await NiceHashApp.hashpower.getMyOrders(nh, c.req.query()));
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default app;
