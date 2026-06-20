import http from 'http';
import express from 'express';
import path from 'path';
import { setupWebSocket } from './ws.js';
import { SyncManager } from '../SyncManager.js'; // Assuming SyncManager is in the root
import { db } from './db.js'; // db is now simpler
import { initNhConfigs, nhConfigs, getNiceHashApp, resolveNhClient } from './nh.js';
import { initMrrConfigs, mrrConfigs, initNonces, syncMrrClock, mrrApiCall } from './mrr.js';
import { registerRoutes } from './routes.js';
import { corsMiddleware, logRequestMiddleware } from './utils.js';
import { runRentalMonitor } from './monitor.js';
import { startMiningOpportunityScanner } from './miningOpportunityNotifier.js';
import { authMiddleware, generateToken } from './auth.js';
import authRoutes from './auth.js';

export function createApp({ distPath }) {
  const app = express();
  app.set('etag', false);
  app.use(express.json({ limit: '2mb' }));
  app.use(corsMiddleware);
  app.use(logRequestMiddleware);

  // Authentication routes
  app.use('/api/auth', authRoutes);

  registerRoutes(app);

  // Create HTTP server and attach WebSocket
  const server = http.createServer(app);
  setupWebSocket(server);
  app.server = server;

  if (distPath) {
    const originalListen = app.listen;
    app.listen = function(...args) {
      return server.listen(...args);
    };
  }

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

    // Validate Authentication Configuration
    const requiredAuth = ['JWT_SECRET', 'ADMIN_USER', 'ADMIN_PASS'];
    const missing = requiredAuth.filter(key => !env[key]);

    if (missing.length > 0) {
      console.warn(`⚠️  WARNING: Missing authentication variables: ${missing.join(', ')}. Login will fail.`);
    } else {
      console.log('✅ Auth Configuration Loaded:');
      console.log(`   - ADMIN_USER: ${env.ADMIN_USER}`);
      console.log(`   - JWT_SECRET: ${env.JWT_SECRET ? '******** (Set)' : 'MISSING'}`);
      console.log(`   - ADMIN_PASS: ${env.ADMIN_PASS ? '******** (Set)' : 'MISSING'}`);
    }

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

  // Start mining opportunity scanner for Telegram alerts
  setTimeout(() => startMiningOpportunityScanner(), 30000);

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
