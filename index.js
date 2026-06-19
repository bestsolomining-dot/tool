import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws'; // Corrected import
import fs from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { createApp, initializeApp } from './server/app.js';
import cors from 'cors'; // Import cors middleware
import { verifyToken } from './server/auth.js';
import { resolveNhClient, getNiceHashApp } from './server/nh.js';
import { mrrApiCall, initMrrConfigs } from './server/mrr.js';
import sqlite3 from 'sqlite3';
import { migrateOldCsvToDb } from './server/migrate.js';
import { initMiningTrainingDb } from './server/miningTrainingDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, 'dist', 'client');

const DATA_DIR = path.join(__dirname, 'data');
const STATS_DB_PATH = path.join(DATA_DIR, 'stats.db');

import { setDb } from './server/db.js';

const app = createApp({ distPath });
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins during development.
// In production, configure this more restrictively based on your frontend's origin(s).
app.use(cors());

/**
 * Realistic User-Agent to prevent being blocked by anti-bot protections 
 * on HeroMiners and Mining-Dutch.
 */
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
};

// Cache for mining addresses and global statistics to improve performance
const addressCache = new Map();
const statsCache = new Map();
const CACHE_TTL = 30000; // 30 seconds
const HERO_MINERS_POOL_LIST_CACHE_KEY = 'herominers_pool_list';
const HERO_MINERS_POOL_DISCOVERY_TTL = 6 * 60 * 60 * 1000; // 6 hours
const heroMinersWarnThrottle = new Map();

/** Persistence layer: Save stats to disk to act as a database */
let dbInstance;

function initDatabase() {
  fs.mkdir(DATA_DIR, { recursive: true }).catch(err => console.error(`[db] Failed to create data directory: ${err.message}`));
  return new Promise((resolve, reject) => {
    dbInstance = new sqlite3.Database(STATS_DB_PATH, (dbErr) => {
      if (dbErr) return reject(dbErr);

      // Enable WAL mode for better concurrency and to prevent SQLITE_BUSY errors.
      dbInstance.run('PRAGMA journal_mode = WAL;', (err) => { if (err) console.warn('[db] Failed to enable WAL mode:', err.message); });

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

      setDb(dbInstance); // Set the shared DB instance for other modules
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

function persistStats() {
  return new Promise((resolve) => {
    const entries = Array.from(statsCache.entries());
    if (entries.length === 0) return resolve();

    const stmt = dbInstance.prepare(`INSERT OR REPLACE INTO stats_cache (key, data, ts) VALUES (?, ?, ?)`);
    let completed = 0;

    entries.forEach(([key, value]) => {
      stmt.run(key, JSON.stringify(value.data), value.ts, (err) => {
        if (err) console.error('[db] Failed to save stats:', err.message);
        completed++;
        if (completed === entries.length) {
          stmt.finalize();
          resolve();
        }
      });
    });
  });
}

function loadStats() {
  return new Promise((resolve) => {
    dbInstance.all(`SELECT key, data, ts FROM stats_cache`, [], (err, rows) => {
      if (err) {
        console.log('[db] No existing stats database found or failed to read, starting fresh.');
        return resolve();
      }
      if (rows) {
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

async function scrapeHeroMinersGlobal(force = false) {
  const CACHE_KEY = 'herominers_global';
  const staleCached = statsCache.get(CACHE_KEY);
  if (!force) {
    const cached = staleCached;
    if (cached && (Date.now() - cached.ts < CACHE_TTL)) return cached.data;
  }

  const now = Date.now();

  const parseNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  const humanHashrate = (value) => {
    const num = parseNumber(value);
    if (!Number.isFinite(num) || num <= 0) return '0 H/s';
    const units = [
      ['EH/s', 1e18],
      ['PH/s', 1e15],
      ['TH/s', 1e12],
      ['GH/s', 1e9],
      ['MH/s', 1e6],
      ['KH/s', 1e3],
    ];
    for (const [unit, factor] of units) {
      if (num >= factor) return `${(num / factor).toFixed(num >= factor * 100 ? 0 : 2)} ${unit}`;
    }
    return `${num.toFixed(0)} H/s`;
  };

  const throttledWarn = (key, message, cooldownMs = 5 * 60 * 1000) => {
    const lastTs = heroMinersWarnThrottle.get(key) || 0;
    if (now - lastTs >= cooldownMs) {
      heroMinersWarnThrottle.set(key, now);
      console.warn(message);
    }
  };

  const fetchPoolList = async () => {
    const cached = statsCache.get(HERO_MINERS_POOL_LIST_CACHE_KEY);
    if (!force && cached && (now - cached.ts < HERO_MINERS_POOL_DISCOVERY_TTL) && Array.isArray(cached.data)) {
      return cached.data;
    }

    const res = await fetch('https://herominers.com/sitemap.xml', {
      headers: COMMON_HEADERS,
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      throw new Error(`HeroMiners sitemap request failed with status: ${res.status}`);
    }

    const xml = await res.text();
    const poolHosts = [...new Set(
      [...xml.matchAll(/https:\/\/([a-z0-9-]+)\.herominers\.com\//gi)]
        .map(match => match[1])
        .filter(host => host && host !== 'herominers')
    )].sort();

    if (poolHosts.length === 0) {
      throw new Error('HeroMiners sitemap returned no pool hosts.');
    }

    statsCache.set(HERO_MINERS_POOL_LIST_CACHE_KEY, { data: poolHosts, ts: now });
    return poolHosts;
  };

  const poolHosts = await fetchPoolList();
  const settled = await Promise.allSettled(poolHosts.map(async (host) => {
    const url = `https://${host}.herominers.com/api/stats`;
    const res = await fetch(url, {
      headers: COMMON_HEADERS,
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      throw new Error(`${host} returned ${res.status}`);
    }
    const data = await res.json();
    return { host, data };
  }));

  const coinStats = [];
  for (const item of settled) {
    if (item.status !== 'fulfilled') {
      throttledWarn(`hero:${item.reason?.message || 'unknown'}`, `[herominers_global] ${item.reason?.message || 'Failed to fetch HeroMiners pool stats.'}`);
      continue;
    }

    const { host, data } = item.value;
    const config = data?.config || {};
    const pool = data?.pool || {};
    const network = data?.network || {};
    const lastblock = data?.lastblock || {};
    const symbol = String(config.symbol || host).toUpperCase();
    const algorithm = String(config.cnAlgorithm || config.algorithm || host).trim();
    const poolHashrate = parseNumber(pool.hashrate) + parseNumber(pool.soloHashrate);
    const miners = parseNumber(pool.miners) + parseNumber(pool.soloMiners);
    const workers = parseNumber(pool.workers) + parseNumber(pool.soloWorkers);
    const priceUsd = parseNumber(pool.price?.usd ?? pool.price?.USD ?? pool.price?.priceUsd);
    const priceBtc = parseNumber(pool.price?.btc ?? pool.price?.BTC ?? pool.price?.priceBtc);
    const blockHeight = lastblock.height || network.height || 0;
    const networkHashrate = parseNumber(network.difficulty) && parseNumber(network.difficultyTarget)
      ? parseNumber(network.difficulty) / parseNumber(network.difficultyTarget)
      : 0;

    coinStats.push({
      coin: symbol,
      symbol,
      host,
      algorithm,
      poolHashrate: humanHashrate(poolHashrate),
      networkHashrate: humanHashrate(networkHashrate),
      blockHeight,
      miners,
      workers,
      usdPerDay: priceUsd,
      btcPerDay: priceBtc,
      priceUsd,
      priceBtc,
      source: 'herominers-api',
      url: `https://${host}.herominers.com/`
    });
  }

  if (coinStats.length === 0) {
    if (staleCached?.data) {
      throttledWarn('hero:stale', '[herominers_global] No pool stats returned; serving stale cached stats.');
      return { ...staleCached.data, stale: true, warning: 'HeroMiners API returned no pool stats.' };
    }

    return {
      success: true,
      coinStats: [],
      rows: [],
      miners: 0,
      workers: 0,
      warning: 'HeroMiners API returned no pool stats.'
    };
  }

  const result = {
    success: true,
    coinStats,
    rows: coinStats,
    totalCoins: coinStats.length,
    miners: coinStats.reduce((acc, c) => acc + (c.miners || 0), 0),
    workers: coinStats.reduce((acc, c) => acc + (c.workers || 0), 0)
  };

  statsCache.set(CACHE_KEY, { data: result, ts: now });
  await persistStats();
  return result;
}

async function scrapeMiningDutchGlobal(force = false) {
  const CACHE_KEY = 'miningdutch_global';
  if (!force) {
    const cached = statsCache.get(CACHE_KEY);
    if (cached && (Date.now() - cached.ts < CACHE_TTL)) return cached.data;
  }

  const url = 'https://www.mining-dutch.nl/';
  try {
    const res = await fetch(url, {
      headers: COMMON_HEADERS,
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      throw new Error(`Mining-Dutch page fetch failed with status: ${res.status}`);
    }

    const htmlContent = await res.text();
    const $ = cheerio.load(htmlContent);
    const coinStats = [];

    const pushUnique = (item) => {
      if (!item?.algorithm) return;
      const key = String(item.algorithm).trim().toLowerCase();
      if (coinStats.some((row) => String(row.algorithm).trim().toLowerCase() === key)) return;
      coinStats.push(item);
    };
    
    const nowMiningTable = $('h4:contains("Currently Mining")').next('table');
    nowMiningTable.find('tbody > tr').each((i, el) => {
      const tds = $(el).find('td');
      if (tds.length < 5) return;

      const algo = $(tds[0]).text().trim();
      const profitabilityText = $(tds[2]).text().trim();
      const profitability = parseFloat(profitabilityText.split(' ')[0]);

      const existing = coinStats.find(c => c.algorithm === algo);
      if (existing) {
        existing.btcPerDay = profitability || 0;
      } else {
        coinStats.push({
          algorithm: algo,
          miners: parseInt($(tds[1]).text().trim(), 10) || 0,
          hashrate: $(tds[4]).text().trim(),
          btcPerDay: profitability || 0,
          usdPerDay: 0, // Will be calculated later if needed
        });
      }
    });

    if (coinStats.length === 0) {
      $('div[class]').each((_, el) => {
        const root = $(el);
        const title = root.find('strong').first().text().trim();
        const buttonCount = root.find('button.btn.btn-info.btn-sm').length;
        const metrics = root.find('h5').map((__, h) => $(h).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
        if (!title || !buttonCount || metrics.length === 0) return;

        const slug = String(root.attr('class') || '').split(/\s+/)[0] || title;
        const currentMetric = metrics[0] || '0';
        const hashMetric = [...metrics].reverse().find((text) => /(?:EH|PH|TH|GH|MH|KH|H|SOL|hs)/i.test(text)) || metrics[metrics.length - 1] || 'N/A';
        const coin = root.find('img[alt]').first().attr('alt') || title;
        const percentMetric = metrics.find((text) => /%$/.test(text)) || '';

        pushUnique({
          algorithm: title,
          coin,
          miners: 0,
          hashrate: hashMetric,
          btcPerDay: Number.parseFloat(currentMetric) || 0,
          usdPerDay: 0,
          spread: percentMetric,
          slug,
        });
      });
    }

    coinStats.forEach(stat => {
      const btcPrice = coinPrices?.bitcoin?.btc || 1;
      stat.usdPerDay = (stat.btcPerDay || 0) * (coinPrices?.bitcoin?.usd || 0) / btcPrice;
    });

    const result = { 
      success: true, 
      coinStats, 
      totalAlgos: coinStats.length,
      algoStats: coinStats.map(c => ({ algo: c.algorithm, hashrate: c.hashrate, miners: c.miners }))
    };

    statsCache.set(CACHE_KEY, { data: result, ts: Date.now() });
    await persistStats();
    return result;
  } catch (err) {
    console.error(`[scrapeMiningDutchGlobal] ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function fetchMiningDutchHtml(force = false) {
  const CACHE_KEY = 'miningdutch_html';
  if (!force) {
    const cached = statsCache.get(CACHE_KEY);
    if (cached && (Date.now() - cached.ts < CACHE_TTL)) return cached.data;
  }

  const url = 'https://www.mining-dutch.nl/';
  const res = await fetch(url, {
    headers: COMMON_HEADERS,
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    throw new Error(`Mining-Dutch page fetch failed with status: ${res.status}`);
  }

  const result = {
    success: true,
    url,
    html: await res.text(),
    fetchedAt: new Date().toISOString()
  };

  statsCache.set(CACHE_KEY, { data: result, ts: Date.now() });
  await persistStats();
  return result;
}

// GET /api/v2/mining/herominers/global – scrape HeroMiners
app.get('/api/v2/mining/herominers/global', async (req, res) => {
  try {
    const data = await scrapeHeroMinersGlobal();
    res.json({ success: true, data });
  } catch (err) {
    console.error('HeroMiners scrape error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// REST API Proxy routes for Mining-Dutch
app.get('/api/v2/mining-dutch/poolstatus', async (req, res) => {
  try {
    const response = await fetch('https://www.mining-dutch.nl/api/v1/public/poolstatus', { headers: COMMON_HEADERS });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v2/mining-dutch/multiport', async (req, res) => {
  try {
    const { method } = req.query;
    if (!method) return res.status(400).json({ success: false, error: 'Method is required' });
    const response = await fetch(`https://www.mining-dutch.nl/api/v1/public/multiport/?method=${method}`, { headers: COMMON_HEADERS });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v2/mining-dutch/user-status', async (req, res) => {
  try {
    const { coin, api_key, id } = req.query;
    if (!coin || !api_key || !id) return res.status(400).json({ success: false, error: 'Missing required parameters' });
    const url = `https://www.mining-dutch.nl/pools/${coin}.php?page=api&action=getuserstatus&api_key=${api_key}&id=${id}`;
    const response = await fetch(url, { headers: COMMON_HEADERS });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v2/mining-dutch/html', async (req, res) => {
  try {
    const data = await fetchMiningDutchHtml(Boolean(req.query.force));
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function startServer() {
  try {
    await initDatabase();
    await cleanAllCache(); // Clean cache before loading anything
    await initMiningTrainingDb();
    await loadStats();
    await migrateOldCsvToDb(); // Run the migration after DB is initialized
    await initMrrConfigs(process.env);
    await initializeApp(process.env);

    const server = app.listen(PORT, (err) => {
      if (err) {
        console.error('[api] Failed to bind port ' + PORT + ':', err.message);
        process.exit(1);
      }

      console.log('--- NiceHash API Toolbox Server Started ---');
      console.log('Environment: ' + (process.env.NICEHASH_ENVIRONMENT ? process.env.NICEHASH_ENVIRONMENT.toUpperCase() : 'production'));
      console.log('Listening on http://localhost:' + PORT);

      // Startup Fetch: Prime the global statistics cache
      console.log('[init] Pre-fetching global pool statistics...');
      scrapeHeroMinersGlobal(true).catch(e => console.warn('[init] HeroMiners pre-fetch failed:', e.message));
      scrapeMiningDutchGlobal(true).catch(e => console.warn('[init] MiningDutch pre-fetch failed:', e.message));
    });

    // Attach WebSocket server to the HTTP server
    server.on('upgrade', (request, socket, head) => {
      try {
        const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
        const pathname = url.pathname.replace(/\/$/, ''); // Remove trailing slash

        if (pathname === '/api/v2/mrr/fetch/ws') {
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
          });
        } else {
          // Only destroy if it's explicitly an API path we don't recognize.
          // If it's a root path, it might be Vite's HMR, so we let it be.
          if (pathname.startsWith('/api')) {
            socket.destroy();
          }
        }
      } catch (err) {
        console.error('[ws:upgrade] Error during upgrade:', err.message);
        socket.destroy();
      }
    });

    server.on('error', (err) => {
      console.error('[api] Server error on port ' + PORT + ':' , err.message);
    });

    function shutdown(signal) {
      console.log('[api] Received ' + signal + ', shutting down...');
      server.close(() => process.exit(0));
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (dbErr) {
    console.error('❌ Critical Initialization Failure:', dbErr.message);
    process.exit(1);
  }
}

// ---------- WebSocket Server Implementation ----------
// Handles real-time stats fetching requests from miningStatsFetcher.js
const wss = new WebSocketServer({ noServer: true });

// Handle server-level WebSocket errors
wss.on('error', (err) => {
  console.error('[wss] Global WebSocket error:', err.message);
});

wss.on('connection', (ws, request) => {
  console.log(`[ws] New connection established`);
  
  ws.on('message', async (data) => {
    try {
      const payload = JSON.parse(data.toString());
      const { action, client, rigid, coin: payloadCoin, requestId, force } = payload;
      let responseData = {};

      // Fetch global statistics for all HeroMiners pools
      if (action === 'herominers_global' || action === 'all') {
        try {
          const scraped = await scrapeHeroMinersGlobal(!!force);
          responseData.herominers_global = { success: true, ...scraped };
        } catch (err) {
          console.error(`[ws:herominers_global] ${err.message}`);
          responseData.herominers_global = { success: false, error: err.message };
        }
      }

      // Fetch address-specific HeroMiners stats (only if action is 'herominers')
      if (action === 'herominers') {
        try {
          // 0. Determine which HeroMiners coin subdomain to use
          let coin = payloadCoin || 'monero';

          // Automatically map algorithm to the correct HeroMiners subdomain
          const algoMap = {
            'randomx': 'monero', 'rx/0': 'monero', 'kawpow': 'ravencoin',
            'ironfish': 'ironfish', 'kheavyhash': 'kaspa', 'kaspa': 'kaspa',
            'autolykos': 'ergo', 'etchash': 'ethereum-classic', 'nexapow': 'nexa',
            'dynex': 'dynex', 'blake3': 'alephium'
          };

          if (!payloadCoin && rigid) {
            const isRental = String(rigid).length >= 5;
            const mrrRes = await mrrApiCall({ 
              endpoint: isRental ? `/rental/${rigid}` : `/rig/${rigid}`, 
              clientNameRaw: client 
            });
            const info = mrrRes.data?.data || mrrRes.data;
            const algo = String(info?.algo || info?.type || info?.algorithm || '').toLowerCase().trim();

            for (const [key, value] of Object.entries(algoMap)) {
              if (algo.includes(key)) {
                coin = value;
                break;
              }
            }
          }

          // 1. Resolve the address for the requested client (check cache first)
          const clientKey = client || 'BT';
          let address = addressCache.get(clientKey);

          if (!address) {
            const { client: nhClientInstance } = resolveNhClient(client);
            const nhApp = getNiceHashApp(nhClientInstance);
            const addrData = await nhApp.mining.getMiningAddress();
            address = addrData?.miningAddress;
            if (address) addressCache.set(clientKey, address);
          }
          if (!address) throw new Error('Could not resolve mining address');

          // 2. Fetch from HeroMiners
          const url = `https://${coin}.herominers.com`;
          console.log(`[ws:herominers] Fetching ${coin} stats for ${address}...`);
          const hmRes = await fetch(url, { 
            headers: COMMON_HEADERS,
            signal: AbortSignal.timeout(10000)
          });
          
          if (hmRes.ok) {
            const stats = await hmRes.json();
            responseData.herominers = { success: true, ...stats };
          } else if (hmRes.status === 404) {
            responseData.herominers = { success: false, error: `Address not found on HeroMiners ${algorithm} pool. Make sure the rig is actively mining to this pool.` };
          } else {
            throw new Error(`HeroMiners returned ${hmRes.status}`);
          }
        } catch (err) {
          console.error(`[ws:herominers] ${err.message}`);
          responseData.herominers = { success: false, error: err.message };
        }
      }

      if (action === 'miningpooldutch' || action === 'all') {
        responseData.miningpooldutch = await scrapeMiningDutchGlobal(!!force);
      }

      // Determine overall success. If "all", we succeed if at least one part exists.
      // If specific action, we succeed only if that specific action succeeded.
      const isSuccess = action === 'all'
        ? (Object.keys(responseData).length > 0) 
        : (responseData[action] && responseData[action].success !== false &&
          (action === 'herominers_global' || action === 'miningpooldutch' ||
           (responseData[action].coinStats?.length > 0 || responseData[action].stats || responseData[action].algoStats?.length > 0)));
      
      const errorMsg = !isSuccess ? (responseData[action]?.error || `No data found for "${action}". Check if mining is active or API is reachable.`) : null;

      // IMPORTANT: We always send the full responseData object.
      // This ensures the frontend always finds data.herominers or data.miningpooldutch
      // regardless of whether one or all were requested, keeping the data shape consistent.
      ws.send(JSON.stringify({
        success: isSuccess,
        error: errorMsg,
        action,
        requestId, // Trả lại ID để frontend match request
        client,
        data: responseData
      }));
    } catch (err) {
      console.error('[ws:message] Error:', err.message);
      ws.send(JSON.stringify({ success: false, error: 'Internal server error: ' + err.message }));
    }
  });
});

if (process.env.RUN_MAIN !== 'false') {
  startServer();
}
