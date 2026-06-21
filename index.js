// index.js
import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupWebSocket } from './server/ws.js';
import { registerRoutes } from './server/routes.js';
import { startMiningOpportunityScanner } from './server/miningOpportunityNotifier.js';
import { createApp, initializeApp } from './server/app.js';
import { verifyToken } from './server/auth.js';
import { resolveNhClient, getNiceHashApp } from './server/nh.js';
import { mrrApiCall, initMrrConfigs } from './server/mrr.js';
import sqlite3 from 'sqlite3';
import { migrateOldCsvToDb } from './server/migrate.js';
import { initMiningTrainingDb } from './server/miningTrainingDb.js';
import { setDb } from './server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, 'dist', 'client');

const DATA_DIR = path.join(__dirname, 'data');
const STATS_DB_PATH = path.join(DATA_DIR, 'stats.db');

// ============================================================
// ✅ FIX: CREATE APP FIRST - BEFORE ANY ROUTES
// ============================================================
const app = createApp({ distPath });
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE - Add after app is created
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// ✅ HEALTH CHECK ROUTES - AFTER app is defined
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid,
    memory: process.memoryUsage ? process.memoryUsage() : undefined
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'NiceHash API Toolbox',
    status: 'running',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      time: '/api/v2/time',
      mining: '/api/v2/mining-stats'
    }
  });
});

// ============================================================
// DATABASE SETUP
// ============================================================
let dbInstance;

function initDatabase() {
  return new Promise((resolve, reject) => {
    dbInstance = new sqlite3.Database(STATS_DB_PATH, (dbErr) => {
      if (dbErr) return reject(dbErr);

      dbInstance.run('PRAGMA journal_mode = WAL;', (err) => {
        if (err) console.warn('[db] Failed to enable WAL mode:', err.message);
      });

      dbInstance.run(`CREATE TABLE IF NOT EXISTS stats_cache (
        key TEXT PRIMARY KEY,
        data TEXT,
        ts INTEGER
      )`, (err) => {
        if (err) reject(err);
      });

      dbInstance.run(`CREATE TABLE IF NOT EXISTS api_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        source TEXT,
        content_type TEXT,
        content TEXT
      )`, (err) => {
        if (err) console.error(`[db] Failed to create api_errors table: ${err.message}`);
      });

      dbInstance.run(`CREATE TABLE IF NOT EXISTS mrr_nonces (
        client TEXT PRIMARY KEY,
        last_nonce TEXT
      )`, (err) => {
        if (err) reject(err);
      });

      dbInstance.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )`, (err) => {
        if (err) console.error(`[db] Failed to create settings table: ${err.message}`);
      });

      setDb(dbInstance);
      resolve();
    });
  });
}

async function cleanAllCache() {
  console.info('[init] Wiping persistent cache for fresh start...');
  try {
    await new Promise((resolve, reject) => {
      dbInstance.run("DELETE FROM stats_cache", (err) => {
        if (err) return reject(err);
        console.info('✨ Persistent cache (stats_cache) cleared.');
        resolve();
      });
    });
  } catch (err) {
    console.error(`[init] Failed to clean persistent cache: ${err.message}`);
  }
}

// ============================================================
// LOAD STATS FUNCTION
// ============================================================
function loadStats() {
  return new Promise((resolve) => {
    if (!dbInstance) {
      console.log('[db] Database not initialized, skipping stats load.');
      return resolve();
    }
    dbInstance.all(`SELECT key, data, ts FROM stats_cache`, [], (err, rows) => {
      if (err) {
        console.log('[db] No existing stats database found or failed to read, starting fresh.');
        return resolve();
      }
      if (rows && rows.length > 0) {
        const statsCache = new Map();
        rows.forEach(row => {
          try {
            statsCache.set(row.key, { data: JSON.parse(row.data), ts: row.ts });
          } catch (e) {
            console.error(`[db] Failed to parse row ${row.key}:`, e.message);
          }
        });
        console.log('[db] Loaded cached stats from SQLite database');
      }
      resolve();
    });
  });
}

// ============================================================
// START SERVER
// ============================================================
async function startServer() {
  try {
    console.log('[init] Initializing database...');
    await initDatabase();
    
    console.log('[init] Cleaning cache...');
    await cleanAllCache();
    
    console.log('[init] Initializing mining training DB...');
    await initMiningTrainingDb();
    
    console.log('[init] Loading stats...');
    await loadStats();
    
    console.log('[init] Migrating old CSV files...');
    await migrateOldCsvToDb();
    
    console.log('[init] Initializing MRR configs...');
    await initMrrConfigs(process.env);
    
    console.log('[init] Initializing app...');
    await initializeApp(process.env);

    console.log('[init] Registering routes...');
    registerRoutes(app);
    console.log('[Routes] All routes registered');

    // Create HTTP server
    const server = http.createServer(app);

    // Setup WebSocket
    setupWebSocket(server);

    // Start the server
    server.listen(PORT, '0.0.0.0', () => {
      console.log('--- NiceHash API Toolbox Server Started ---');
      console.log('Environment: ' + (process.env.NICEHASH_ENVIRONMENT ? process.env.NICEHASH_ENVIRONMENT.toUpperCase() : 'production'));
      console.log(`Listening on http://localhost:${PORT}`);
      console.log(`WebSocket: ws://localhost:${PORT}/api/v2/mrr/fetch/ws`);
      
      // Start mining scanner after a delay
      setTimeout(() => {
        console.log('[Mining Scanner] Initializing...');
        try {
          startMiningOpportunityScanner();
        } catch (err) {
          console.error('[Mining Scanner] Failed to start:', err.message);
        }
      }, 5000);
    });

    // Graceful shutdown
    function shutdown(signal) {
      console.log(`[api] Received ${signal}, shutting down...`);
      server.close(() => {
        console.log('[api] Server closed');
        process.exit(0);
      });
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (err) {
    console.error('❌ Critical Initialization Failure:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// ============================================================
// START THE SERVER
// ============================================================
if (process.env.RUN_MAIN !== 'false') {
  startServer().catch((err) => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  });
}