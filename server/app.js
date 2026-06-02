import express from 'express';
import path from 'path';
import { SyncManager } from '../SyncManager.js';
import { db, initDatabase, cleanAllCache } from './db.js';
import { nhConfigs, getNiceHashApp, resolveNhClient } from './nh.js';
import { mrrConfigs, initNonces, syncMrrClock, mrrApiCall } from './mrr.js';
import { registerRoutes } from './routes.js';
import { corsMiddleware, logRequestMiddleware } from './utils.js';
import { runRentalMonitor } from './monitor.js';

export function createApp({ distPath }) {
  const app = express();
  app.set('etag', false);
  app.use(express.json());
  app.use(corsMiddleware);
  app.use(logRequestMiddleware);
  registerRoutes(app);

  if (distPath) {
    app.use(express.static(distPath));
    app.get(/.*/, (req, res) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Not Found' });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

export async function initializeApp() {
  await cleanAllCache();
  await initDatabase();
  await initNonces();
  await syncMrrClock();

  const syncManager = new SyncManager({ db, nhConfigs, mrrConfigs, mrrApiCall, resolveNhClient, getNiceHashApp });
  syncManager.run();

  setInterval(() => runRentalMonitor(), 60000);
  runRentalMonitor();

  try {
    const { client } = resolveNhClient('BT');
    if (client) {
      getNiceHashApp(client).public.getTime().then((t) => {
        console.log('✅ Connection verified. Server Time:', new Date(t).toLocaleString());
      }).catch((e) => console.warn('⚠️ NiceHash connectivity check failed on start:', e.message));
    }
  } catch (error) {
    console.error('❌ Initialization Error:', error.message);
  }
}
