import express from 'express';
import path from 'path';
import { SyncManager } from '../SyncManager.js';
import { db, initDatabase, cleanAllCache } from './db.js';
import { initNhConfigs, nhConfigs, getNiceHashApp, resolveNhClient } from './nh.js';
import { initMrrConfigs, mrrConfigs, initNonces, syncMrrClock, mrrApiCall } from './mrr.js';
import { registerRoutes } from './routes.js';
import { corsMiddleware, logRequestMiddleware } from './utils.js';
import { runRentalMonitor } from './monitor.js';
import { authMiddleware, generateToken } from './auth.js';
import authRoutes from './auth.js';

export function createApp({ distPath }) {
  const app = express();
  app.set('etag', false);
  app.use(express.json());
  app.use(corsMiddleware);
  app.use(logRequestMiddleware);

  // Authentication routes
  app.use('/api/auth', authRoutes);

  // Protect all other /api routes
  app.use('/api', authMiddleware);

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

export async function initializeApp(env) {
  try {
    console.log('🚀 Initializing system...');
    initNhConfigs(env); // Initialize NiceHash configurations
    initMrrConfigs(env); // Initialize MiningRigRentals configurations
    await initDatabase();
    await cleanAllCache();
    await initNonces();
    await syncMrrClock();
  } catch (error) {
    console.error('❌ Critical Initialization Failure:', error.message);
    process.exit(1);
  }

  const syncManager = new SyncManager({ db, nhConfigs, mrrConfigs, mrrApiCall, resolveNhClient, getNiceHashApp });
  syncManager.run();

  // Start the monitor with a safe recursive pattern to prevent overlaps
  const startMonitor = async () => {
    try {
      await runRentalMonitor();
    } catch (err) {
      console.error('[Monitor] Loop error:', err.message);
    } finally {
      // Schedule next run in 60s
      setTimeout(startMonitor, 60000);
    }
  };

  startMonitor();

  // Delay first heartbeat until sync/app load is complete (15s)
  setTimeout(() => runRentalMonitor(true), 15000);

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
