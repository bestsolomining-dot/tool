// miningOpportunityNotifier.js
import path from "path";
import fs from "node:fs/promises";
import sqlite3 from "sqlite3";
import * as cheerio from "cheerio";
import { 
  ALGO_DISPLAY_NAMES, 
  NICEHASH_ALGO_MAP, 
  normalizeAlgoForNiceHash, 
  getAlgorithmDisplayName,
  getAlgorithmUnit,
  normalizeAlgo 
} from "../src/core/mapping.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const TRENDS_DB_PATH = path.join(DATA_DIR, "mining_trends.db");
const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Accept": "text/html,application/json,application/xml",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

let lastNotifiedOpportunities = new Map();
let opportunityDb = null;
let dbInitPromise = null;

const TREND_WINDOW_HOURS = 24;
const MIN_NOTIFY_INTERVAL_MS = 30 * 60 * 1000;
const SPREAD_THRESHOLD_PCT = 5;

// =========================
//  DB
// =========================
function openDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(TRENDS_DB_PATH, (err) => {
      if (err) return reject(err);
      resolve(db);
    });
  });
}

async function getTrendDb() {
  if (opportunityDb) return opportunityDb;
  if (dbInitPromise) return dbInitPromise;
  dbInitPromise = (async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const db = await openDb();
    await run(db, "PRAGMA journal_mode = WAL");
    await run(db, `CREATE TABLE IF NOT EXISTS mining_opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      algo TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      pool_btc_per_day REAL DEFAULT 0,
      nh_price_btc REAL DEFAULT 0,
      mrr_price_btc REAL DEFAULT 0,
      spread_pct REAL DEFAULT 0,
      pool_miners INTEGER DEFAULT 0,
      trend_direction TEXT DEFAULT 'stable',
      summary_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(db, `CREATE INDEX IF NOT EXISTS idx_opp_algo_time 
      ON mining_opportunities(algo, captured_at)`);
    opportunityDb = db;
    return db;
  })();
  return dbInitPromise;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// =========================
//  Telegram send (TELEGRAM_MINE_BOT_TOKEN)
// =========================
async function sendMineTelegram(message) {
  const botToken = process.env.TELEGRAM_MINE_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GROUP_ID;
  if (!botToken || !chatId) {
    console.warn("[mine:tg] TELEGRAM_MINE_BOT_TOKEN or TELEGRAM_GROUP_ID not configured");
    return null;
  }
  const text = String(message || "").trim();
  if (!text) return null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
        }
      );
      const data = await res.json();
      if (res.ok && data?.ok) return data;
      throw new Error(data?.description || `HTTP ${res.status}`);
    } catch (err) {
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500));
      else console.error("[mine:tg] Failed to send:", err.message);
    }
  }
  return null;
}

// =========================
//  HERO MINERS - Comprehensive Scraper with Discovery
// =========================

// Known working algorithms (verified)
const KNOWN_WORKING_ALGOS = [
  'randomx',
  'cryptonight',
  'kawpow',
  'etchash',
  'autolykos',
  'equihash',
  'zhash',
  'beamv3'
];

// Algorithms that might exist
const EXPERIMENTAL_ALGOS = [
  'octopus',
  'verushash',
  'nexapow',
  'fishhash',
  'dynexsolve',
  'blake3',
  'kheavyhash',
  'eaglesong',
  'xelishashv3',
  'janushash',
  'progpowz',
  'pearlhash',
  'x11',
  'lyra2rev2',
  'neoscrypt',
  'yespower',
  'argon2',
  'mtp',
  'yescrypt',
  'cryptonightv7',
  'cryptonightr'
];

// Algorithm name mappings (HeroMiners -> NiceHash)
const ALGO_MAPPINGS = {
  'randomx': 'RANDOMXMONERO',
  'cryptonight': 'CRYPTONIGHT',
  'cryptonightv7': 'CRYPTONIGHT',
  'cryptonightr': 'CRYPTONIGHT',
  'kawpow': 'KAWPOW',
  'etchash': 'ETCHASH',
  'autolykos': 'AUTOLYKOS',
  'equihash': 'EQUIHASH',
  'zhash': 'ZHASH',
  'beamv3': 'BEAMV3',
  'octopus': 'OCTOPUS',
  'verushash': 'VERUSHASH',
  'nexapow': 'NEXAPOW',
  'fishhash': 'FISHHASH',
  'dynexsolve': 'DYNEXSOLVE',
  'blake3': 'BLAKE3_ALPH',
  'kheavyhash': 'KHEAVYHASH',
  'eaglesong': 'EAGLESONG',
  'xelishashv3': 'XELISHASHV3',
  'janushash': 'JANUSHASH',
  'progpowz': 'PROGPOWZ',
  'pearlhash': 'PEARLHASH',
  'x11': 'X11',
  'lyra2rev2': 'LYRA2REV2',
  'neoscrypt': 'NEOSCRYPT',
  'yespower': 'YESPOWER',
  'argon2': 'ARGON2',
  'mtp': 'MTP'
};

/**
 * Discover available HeroMiners algorithms from sitemap and homepage
 */
async function discoverHeroMinersAlgorithms() {
  const discovered = new Set();
  
  try {
    // Method 1: Sitemap
    const sitemapRes = await fetch('https://herominers.com/sitemap.xml', {
      headers: COMMON_HEADERS,
      signal: AbortSignal.timeout(10000)
    });
    
    if (sitemapRes.ok) {
      const xml = await sitemapRes.text();
      const hosts = [...xml.matchAll(/https:\/\/([a-z0-9-]+)\.herominers\.com\//gi)]
        .map(m => m[1])
        .filter(h => h && h !== 'herominers' && !h.includes('www'));
      
      hosts.forEach(h => discovered.add(h));
      console.log(`[HeroMiners] Found ${hosts.length} algos from sitemap`);
    }
  } catch (err) {
    console.log('[HeroMiners] Sitemap discovery failed');
  }
  
  // Method 2: Check known working algorithms
  for (const algo of KNOWN_WORKING_ALGOS) {
    discovered.add(algo);
  }
  
  // Method 3: Try to discover from homepage
  try {
    const homeRes = await fetch('https://herominers.com/', {
      headers: COMMON_HEADERS,
      signal: AbortSignal.timeout(10000)
    });
    
    if (homeRes.ok) {
      const html = await homeRes.text();
      const $ = cheerio.load(html);
      
      // Look for algorithm links
      $('a[href*="/pool/"]').each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
          const match = href.match(/\/pool\/([a-z0-9-]+)/);
          if (match && match[1] && !match[1].includes('www')) {
            discovered.add(match[1]);
          }
        }
      });
    }
  } catch (err) {
    console.log('[HeroMiners] Homepage discovery failed');
  }
  
  // Add experimental algos as fallback
  for (const algo of EXPERIMENTAL_ALGOS) {
    discovered.add(algo);
  }
  
  return Array.from(discovered);
}

/**
 * Get BTC price for USD conversion
 */
async function getBtcPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', {
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    return data?.bitcoin?.usd || 60000;
  } catch {
    return 60000; // fallback
  }
}

/**
 * Check if an algorithm exists on HeroMiners
 */
async function algorithmExists(algorithm) {
  try {
    // Try HEAD request first
    const res = await fetch(`https://herominers.com/pool/${algorithm}`, {
      method: 'HEAD',
      headers: COMMON_HEADERS,
      signal: AbortSignal.timeout(5000)
    });
    
    if (res.ok) return true;
    
    // Try API endpoint
    const apiRes = await fetch(`https://${algorithm}.herominers.com/api/stats`, {
      method: 'HEAD',
      headers: COMMON_HEADERS,
      signal: AbortSignal.timeout(5000)
    });
    
    return apiRes.ok;
  } catch {
    return false;
  }
}

/**
 * Scrape a single HeroMiners algorithm page with fallback
 */
async function scrapeHeroMinersAlgorithm(algorithm, btcPrice) {
  const allRows = [];
  
  // Try multiple URL patterns
  const urlPatterns = [
    `https://herominers.com/pool/${algorithm}`,
    `https://herominers.com/stats/${algorithm}`,
    `https://${algorithm}.herominers.com/api/stats`,
    `https://${algorithm}.herominers.com/`
  ];
  
  for (const url of urlPatterns) {
    try {
      const response = await fetch(url, {
        headers: {
          ...COMMON_HEADERS,
          'Accept': 'text/html,application/json,application/xml'
        },
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) continue;
      
      const contentType = response.headers.get('content-type') || '';
      let rows = [];
      
      // JSON response
      if (contentType.includes('json')) {
        try {
          const data = await response.json();
          rows = parseHeroMinersJson(data, algorithm, btcPrice);
          if (rows.length > 0) {
            allRows.push(...rows);
            continue;
          }
        } catch (e) {
          // JSON parsing failed
        }
      }
      
      // XML response (some endpoints return XML)
      if (contentType.includes('xml')) {
        try {
          const xml = await response.text();
          rows = parseHeroMinersXml(xml, algorithm, btcPrice);
          if (rows.length > 0) {
            allRows.push(...rows);
            continue;
          }
        } catch (e) {
          // XML parsing failed
        }
      }
      
      // HTML response
      const html = await response.text();
      rows = parseHeroMinersHtml(html, algorithm, btcPrice);
      if (rows.length > 0) {
        allRows.push(...rows);
        continue;
      }
      
    } catch (err) {
      // Try next URL
      continue;
    }
  }
  
  return allRows;
}

/**
 * Parse HeroMiners XML response
 */
function parseHeroMinersXml(xml, algorithm, btcPrice) {
  const rows = [];
  const $ = cheerio.load(xml, { xmlMode: true });
  
  $('pool, coin, stats').each((i, el) => {
    const coin = $(el).find('coin, symbol, name').text().trim() || algorithm.toUpperCase();
    const miners = parseInt($(el).find('miners, workers').text()) || 0;
    const hashrate = $(el).find('hashrate, poolHashrate').text().trim() || 'N/A';
    const btcPerDay = parseFloat($(el).find('price, btcPerDay, expected').text()) || 0;
    
    if (miners > 0 || btcPerDay > 0) {
      rows.push({
        algorithm,
        coin: coin.toUpperCase(),
        miners,
        hashrate,
        btcPerDay,
        usdPerDay: btcPerDay * btcPrice
      });
    }
  });
  
  return rows;
}

/**
 * Parse HeroMiners JSON response
 */
function parseHeroMinersJson(data, algorithm, btcPrice) {
  const rows = [];
  
  // Try different data structures
  const pool = data?.pool || data?.data?.pool || data;
  const config = data?.config || data?.data?.config || {};
  
  if (pool && typeof pool === 'object') {
    const coin = String(config.symbol || algorithm).toUpperCase();
    const miners = parseInt(pool.miners || pool.workers || 0);
    const hashrate = pool.hashrate || pool.poolHashrate || 'N/A';
    const btcPerDay = parseFloat(pool.price?.btc || pool.price?.BTC || pool.expected || 0);
    
    if (miners > 0 || btcPerDay > 0) {
      rows.push({
        algorithm,
        coin,
        miners,
        hashrate: String(hashrate),
        btcPerDay,
        usdPerDay: btcPerDay * btcPrice
      });
    }
  }
  
  // Multiple coins
  const coins = data?.coins || data?.data?.coins || data?.result || data?.stats;
  if (coins && typeof coins === 'object') {
    for (const [coin, info] of Object.entries(coins)) {
      if (typeof info === 'object' && info !== null) {
        const miners = parseInt(info.miners || info.workers || 0);
        const btcPerDay = parseFloat(info.btcPerDay || info.expected || 0);
        
        if (miners > 0 || btcPerDay > 0) {
          rows.push({
            algorithm,
            coin: coin.toUpperCase(),
            miners,
            hashrate: String(info.hashrate || info.poolHashrate || 'N/A'),
            btcPerDay,
            usdPerDay: btcPerDay * btcPrice
          });
        }
      }
    }
  }
  
  return rows;
}

/**
 * Parse HeroMiners HTML to extract coin data
 */
function parseHeroMinersHtml(html, algorithm, btcPrice) {
  const rows = [];
  const $ = cheerio.load(html);
  
  // Look for tables with mining data
  $('table').each((i, table) => {
    $(table).find('tbody > tr, tr').each((j, row) => {
      const tds = $(row).find('td');
      if (tds.length >= 3) {
        const coin = $(tds[0]).text().trim() || 'Unknown';
        const miners = parseInt($(tds[1]).text().replace(/,/g, '')) || 0;
        const hashrate = $(tds[2]).text().trim() || 'N/A';
        const btcPerDay = parseFloat($(tds[3])?.text()?.replace(/[^0-9.]/g, '') || 0);
        
        if (coin !== 'Unknown' || miners > 0 || btcPerDay > 0) {
          rows.push({
            algorithm,
            coin,
            miners,
            hashrate,
            btcPerDay,
            usdPerDay: btcPerDay * btcPrice
          });
        }
      }
    });
  });
  
  // If no table, try div-based layout
  if (rows.length === 0) {
    $('div[class*="coin"], div[class*="stat"], div[class*="miner"]').each((i, el) => {
      const coin = $(el).find('[class*="name"], [class*="symbol"]').text().trim() || algorithm.toUpperCase();
      const miners = parseInt($(el).find('[class*="miner"], [class*="worker"]').text().replace(/,/g, '')) || 0;
      const hashrate = $(el).find('[class*="hashrate"]').text().trim() || 'N/A';
      const btcPerDay = parseFloat($(el).find('[class*="btc"], [class*="price"]').text().replace(/[^0-9.]/g, '')) || 0;
      
      if (coin && (miners > 0 || btcPerDay > 0)) {
        rows.push({
          algorithm,
          coin,
          miners,
          hashrate,
          btcPerDay,
          usdPerDay: btcPerDay * btcPrice
        });
      }
    });
  }
  
  // If still no data, try script tags with JSON
  if (rows.length === 0) {
    $('script').each((i, script) => {
      const content = $(script).html();
      if (content) {
        const matches = content.match(/(?:var|let|const)\s+(?:data|stats|pool)\s*=\s*({[\s\S]*?});/g);
        if (matches) {
          for (const match of matches) {
            try {
              const jsonMatch = match.match(/({[\s\S]*?})/);
              if (jsonMatch) {
                const data = JSON.parse(jsonMatch[1]);
                const jsonRows = parseHeroMinersJson(data, algorithm, btcPrice);
                rows.push(...jsonRows);
              }
            } catch (e) {
              // JSON parsing failed
            }
          }
        }
      }
    });
  }
  
  return rows;
}

/**
 * Scrape all HeroMiners algorithms
 */
export async function scrapeHeroMinersGlobal(force = true) {
  try {
    console.log('[HeroMiners] Starting comprehensive scrape...');
    const btcPrice = await getBtcPrice();
    console.log(`[HeroMiners] BTC Price: $${btcPrice}`);
    
    // Discover available algorithms
    let algorithms = await discoverHeroMinersAlgorithms();
    console.log(`[HeroMiners] Discovered ${algorithms.length} algorithms to try`);
    
    // If we have too many, prioritize known working ones first
    const prioritized = [
      ...KNOWN_WORKING_ALGOS.filter(a => algorithms.includes(a)),
      ...algorithms.filter(a => !KNOWN_WORKING_ALGOS.includes(a))
    ];
    
    const allCoinStats = [];
    let totalMiners = 0;
    let successfulAlgos = 0;
    
    for (const algo of prioritized) {
      try {
        const rows = await scrapeHeroMinersAlgorithm(algo, btcPrice);
        
        if (rows && rows.length > 0) {
          // Map algorithm name to NiceHash format
          const mappedAlgo = ALGO_MAPPINGS[algo] || algo.toUpperCase();
          const enhancedRows = rows.map(row => ({
            ...row,
            normalizedAlgo: normalizeAlgo(mappedAlgo),
            nicehashAlgo: mappedAlgo
          }));
          
          allCoinStats.push(...enhancedRows);
          const algoMiners = rows.reduce((sum, r) => sum + (r.miners || 0), 0);
          totalMiners += algoMiners;
          successfulAlgos++;
          console.log(`[HeroMiners] ✓ ${algo}: ${rows.length} coins, ${algoMiners} miners`);
        } else {
          console.log(`[HeroMiners] ✗ ${algo}: No data found`);
        }
        
        // Rate limiting
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.log(`[HeroMiners] ✗ ${algo}: Error - ${err.message}`);
      }
    }
    
    console.log(`[HeroMiners] Complete: ${successfulAlgos}/${prioritized.length} algos, ${allCoinStats.length} coins, ${totalMiners} miners`);
    
    // Save to database for trends
    const db = await getTrendDb();
    const capturedAt = new Date().toISOString();
    for (const row of allCoinStats) {
      const normalizedAlgo = row.normalizedAlgo || normalizeAlgo(row.algorithm || '');
      await run(db,
        `INSERT INTO mining_opportunities (algo, captured_at, pool_btc_per_day, pool_miners, summary_json)
         VALUES (?, ?, ?, ?, ?)`,
        [normalizedAlgo || row.algorithm, capturedAt, row.btcPerDay, row.miners, JSON.stringify(row)]
      );
    }
    
    return {
      success: true,
      coinStats: allCoinStats,
      miners: totalMiners,
      fetchedAt: capturedAt,
      algorithmsScraped: successfulAlgos,
      totalAlgorithms: prioritized.length,
      totalCoins: allCoinStats.length
    };
    
  } catch (err) {
    console.error('[HeroMiners] Scrape failed:', err);
    return { success: false, error: err.message, coinStats: [] };
  }
}

// =========================
//  Scrape Mining-Dutch (Enhanced)
// =========================
export async function scrapeMiningDutchGlobal(force = false) {
  try {
    console.log('[Mining-Dutch] Scraping...');
    const btcPrice = await getBtcPrice();
    
    // Try API first
    try {
      const apiRes = await fetch('https://www.mining-dutch.nl/api/v1/public/multiport/?method=avgprofitability', {
        headers: COMMON_HEADERS,
        signal: AbortSignal.timeout(10000)
      });
      
      if (apiRes.ok) {
        const json = await apiRes.json();
        if (json?.success && json?.result) {
          const coinStats = Object.entries(json.result).map(([algorithm, data]) => {
            const btcPerDay = parseFloat(data.expected || data.average || 0);
            return {
              algorithm: algorithm,
              normalizedAlgo: normalizeAlgo(algorithm),
              nicehashAlgo: ALGO_MAPPINGS[algorithm.toLowerCase()] || algorithm.toUpperCase(),
              coin: algorithm.toUpperCase(),
              miners: 0,
              btcPerDay: Number.isFinite(btcPerDay) ? btcPerDay : 0,
              usdPerDay: Number.isFinite(btcPerDay) ? btcPerDay * btcPrice : 0,
              hashrate: 'N/A'
            };
          });
          console.log(`[Mining-Dutch] API: ${coinStats.length} algos`);
          return { success: true, coinStats };
        }
      }
    } catch (err) {
      console.warn('[Mining-Dutch] API failed, falling back to HTML:', err.message);
    }
    
    // Fallback to HTML scraping
    const res = await fetch("https://www.mining-dutch.nl/", {
      headers: COMMON_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Dutch: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const coinStats = [];
    
    // Try to find the mining data table
    const tables = $('table');
    for (let i = 0; i < tables.length; i++) {
      const table = $(tables[i]);
      const rows = table.find('tbody > tr');
      if (rows.length > 0) {
        rows.each((j, el) => {
          const tds = $(el).find('td');
          if (tds.length >= 3) {
            const algorithm = $(tds[0]).text().trim();
            const btcPerDay = parseFloat($(tds[1]).text().trim()) || 0;
            const miners = parseInt($(tds[2]).text().trim()) || 0;
            
            if (algorithm && (btcPerDay > 0 || miners > 0)) {
              const algoLower = algorithm.toLowerCase();
              coinStats.push({
                algorithm,
                normalizedAlgo: normalizeAlgo(algorithm),
                nicehashAlgo: ALGO_MAPPINGS[algoLower] || algorithm.toUpperCase(),
                coin: algorithm.toUpperCase(),
                miners,
                btcPerDay,
                usdPerDay: btcPerDay * btcPrice,
                hashrate: 'N/A'
              });
            }
          }
        });
        if (coinStats.length > 0) break;
      }
    }
    
    console.log(`[Mining-Dutch] HTML: ${coinStats.length} algos`);
    return { success: true, coinStats };
    
  } catch (err) {
    console.error("[mine:dutch]", err.message);
    return { success: false, error: err.message, coinStats: [] };
  }
}

// =========================
//  Fetch NH Prices
// =========================
async function fetchNhPrices(algos, nhClient = "BT") {
  const results = {};
  if (!Array.isArray(algos) || algos.length === 0) return results;
  const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
  const settled = await Promise.allSettled(
    algos.map(async (algo) => {
      try {
        const r = await fetch(
          `${baseUrl}/api/v2/hashpower/order/price?algorithm=${encodeURIComponent(algo)}&client=${nhClient}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!r.ok) return [algo, 0];
        const d = await r.json();
        const price = parseFloat(d?.price ?? d?.fixedPrice ?? d?.marketPrice ?? 0);
        return [algo, Number.isFinite(price) ? price : 0];
      } catch { return [algo, 0]; }
    })
  );
  for (const item of settled) {
    if (item.status === "fulfilled") results[item.value[0]] = item.value[1];
  }
  return results;
}

// =========================
//  Trend analysis
// =========================
async function analyzeTrends(normalizedAlgo) {
  try {
    const db = await getTrendDb();
    const cutoff = new Date(Date.now() - TREND_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const rows = await all(
      db,
      `SELECT captured_at, spread_pct, pool_btc_per_day, pool_miners 
       FROM mining_opportunities WHERE algo = ? AND captured_at >= ? ORDER BY captured_at ASC`,
      [normalizedAlgo, cutoff]
    );
    if (rows.length < 3) return { direction: "insufficient", samples: rows.length, avgSpread: 0 };
    const oldest = rows[0];
    const newest = rows[rows.length - 1];
    const spreadChange = newest.spread_pct - oldest.spread_pct;
    let direction = "stable";
    if (spreadChange > 3) direction = "improving";
    else if (spreadChange < -3) direction = "declining";
    return { direction, spreadChange, samples: rows.length };
  } catch (err) {
    console.error("[mine:trend]", err.message);
    return { direction: "error", samples: 0, avgSpread: 0 };
  }
}

// =========================
//  Main scanner
// =========================
export async function scanMiningOpportunities(force = false) {
  console.log(`[mine:scan] Scanning mining opportunities...`);
  const [heroRes, dutchRes] = await Promise.all([
    scrapeHeroMinersGlobal(force),
    scrapeMiningDutchGlobal(force),
  ]);

  const algoSet = new Set();
  for (const row of heroRes?.coinStats || []) {
    if (row.normalizedAlgo && row.normalizedAlgo !== "UNKNOWN") algoSet.add(row.normalizedAlgo);
    if (row.nicehashAlgo) algoSet.add(row.nicehashAlgo);
  }
  for (const row of dutchRes?.coinStats || []) {
    if (row.normalizedAlgo && row.normalizedAlgo !== "UNKNOWN") algoSet.add(row.normalizedAlgo);
    if (row.nicehashAlgo) algoSet.add(row.nicehashAlgo);
  }

  const algos = Array.from(algoSet).filter(Boolean);
  if (algos.length === 0) return { success: false, error: "No algos found" };

  const nhPrices = await fetchNhPrices(algos);

  const heroByAlgo = new Map();
  for (const row of heroRes?.coinStats || []) {
    const k = row.nicehashAlgo || row.normalizedAlgo;
    if (!heroByAlgo.has(k)) heroByAlgo.set(k, { btcPerDay: 0, miners: 0, coins: [] });
    const cur = heroByAlgo.get(k);
    cur.btcPerDay = Math.max(cur.btcPerDay, row.btcPerDay);
    cur.miners += row.miners || 0;
    if (row.coin) cur.coins.push(row.coin);
  }

  const dutchByAlgo = new Map();
  for (const row of dutchRes?.coinStats || []) {
    const k = row.nicehashAlgo || row.normalizedAlgo;
    if (!dutchByAlgo.has(k)) dutchByAlgo.set(k, { btcPerDay: 0, miners: 0 });
    const cur = dutchByAlgo.get(k);
    cur.btcPerDay = Math.max(cur.btcPerDay, row.btcPerDay);
    cur.miners += row.miners || 0;
  }

  const opportunities = [];
  for (const algo of algos) {
    const hero = heroByAlgo.get(algo);
    const dutch = dutchByAlgo.get(algo);
    const poolBtc = Math.max(hero?.btcPerDay || 0, dutch?.btcPerDay || 0);
    const nhPrice = nhPrices[algo] || 0;
    const spread = poolBtc > 0 && nhPrice > 0 ? ((poolBtc - nhPrice) / nhPrice) * 100 : null;
    opportunities.push({
      algo,
      label: getAlgorithmDisplayName(algo),
      poolBtcPerDay: poolBtc,
      nhPriceBtc: nhPrice,
      spreadPct: spread,
      poolMiners: Math.max(hero?.miners || 0, dutch?.miners || 0),
      source: poolBtc > 0 ? (dutch?.btcPerDay > hero?.btcPerDay ? "Mining-Dutch" : "HeroMiners") : "N/A",
      heroCoins: hero?.coins || []
    });
  }

  opportunities.sort((a, b) => {
    const sa = a.spreadPct ?? -Infinity;
    const sb = b.spreadPct ?? -Infinity;
    if (sb !== sa) return sb - sa;
    return b.poolBtcPerDay - a.poolBtcPerDay;
  });

  const db = await getTrendDb();
  const capturedAt = new Date().toISOString();
  const notifyMessages = [];

  for (const opp of opportunities) {
    const trend = await analyzeTrends(opp.algo);
    await run(db,
      `INSERT INTO mining_opportunities (algo, captured_at, pool_btc_per_day, nh_price_btc, mrr_price_btc, spread_pct, pool_miners, trend_direction, summary_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [opp.algo, capturedAt, opp.poolBtcPerDay, opp.nhPriceBtc, 0, opp.spreadPct ?? 0, opp.poolMiners, trend.direction, JSON.stringify(opp)]
    );
    opp.trend = trend;

    const shouldNotify = opp.spreadPct !== null && opp.spreadPct >= SPREAD_THRESHOLD_PCT && opp.poolBtcPerDay > 0;
    if (shouldNotify) {
      const lastNotified = lastNotifiedOpportunities.get(opp.algo) || 0;
      const timeSinceLast = Date.now() - lastNotified;
      const isFresh = timeSinceLast > MIN_NOTIFY_INTERVAL_MS || (opp.trend.direction === "improving" && timeSinceLast > 15 * 60 * 1000);
      if (isFresh || force) {
        lastNotifiedOpportunities.set(opp.algo, Date.now());
        notifyMessages.push(opp);
      }
    }
  }

  if (notifyMessages.length > 0) await sendOpportunityAlerts(notifyMessages);

  const positiveCount = opportunities.filter((o) => o.spreadPct !== null && o.spreadPct > 0).length;
  if (positiveCount > 0) await sendMiningSummary(opportunities.filter((o) => o.spreadPct !== null && o.spreadPct > 0).slice(0, 10));

  return { 
    success: true, 
    scannedAt: capturedAt, 
    totalAlgos: algos.length, 
    opportunities: opportunities.slice(0, 20), 
    notificationsSent: notifyMessages.length, 
    positiveCount,
    heroCoins: heroRes?.coinStats?.length || 0,
    dutchCoins: dutchRes?.coinStats?.length || 0
  };
}

// =========================
//  Alerts & Summary
// =========================
async function sendOpportunityAlerts(opportunities) {
  for (const opp of opportunities) {
    const emoji = opp.spreadPct >= 20 ? "🔥" : opp.spreadPct >= 10 ? "💰" : "✅";
    const trendEmoji = opp.trend?.direction === "improving" ? "📈" : opp.trend?.direction === "declining" ? "📉" : "➡️";
    const msg = `${emoji} <b>Mining Opportunity</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `<b>Algo:</b> <code>${opp.label}</code>\n` +
      `<b>Pool Revenue:</b> <code>${opp.poolBtcPerDay.toFixed(8)} BTC/day</code>\n` +
      `<b>NiceHash Cost:</b> <code>${opp.nhPriceBtc.toFixed(8)} BTC/day</code>\n` +
      `<b>Spread:</b> <code>${opp.spreadPct >= 0 ? "+" : ""}${opp.spreadPct.toFixed(2)}%</code>\n` +
      `<b>Source:</b> ${opp.source}\n` +
      `<b>Miners:</b> ${opp.poolMiners}\n` +
      (opp.heroCoins.length > 0 ? `<b>Coins:</b> ${opp.heroCoins.slice(0, 5).join(', ')}${opp.heroCoins.length > 5 ? ` +${opp.heroCoins.length - 5}` : ''}\n` : '') +
      `${trendEmoji} <b>Trend:</b> ${opp.trend?.direction || "N/A"} (${opp.trend?.samples || 0} samples)\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `<i>Mine on pool, arbitrage vs NiceHash</i>`;
    await sendMineTelegram(msg);
  }
}

async function sendMiningSummary(topOpps) {
  const lines = topOpps.map((o, i) => {
    const pct = o.spreadPct >= 0 ? "+" + o.spreadPct.toFixed(2) : o.spreadPct.toFixed(2);
    const emoji = o.spreadPct >= 20 ? "🔥" : o.spreadPct >= 10 ? "💰" : "✅";
    return `${emoji} <b>${i + 1}. ${o.label}</b> — ${o.poolBtcPerDay.toFixed(8)} BTC/day (${pct}%) | ${o.poolMiners} miners`;
  });
  const msg = `📊 <b>Mining Opportunity Summary</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `<b>Time:</b> ${new Date().toLocaleTimeString()}\n` +
    `<b>Profitable algos:</b> ${topOpps.length}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    lines.join("\n") +
    `\n━━━━━━━━━━━━━━━━━━\n` +
    `<i>Updated automatically every 30 min</i>`;
  await sendMineTelegram(msg);
}

// =========================
//  API route handler
// =========================
export async function handleMiningOpportunityScan(req, res) {
  try {
    const force = req.query?.force === "true";
    const result = await scanMiningOpportunities(force);
    res.json(result);
  } catch (err) {
    console.error("[mine:scan:error]", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

// =========================
//  Background scheduler
// =========================
let scanInterval = null;

export function startMiningOpportunityScanner() {
  if (scanInterval) { console.log("[mine:scan] Already running"); return; }
  console.log("[mine:scan] Starting background scanner (every 30 min)");
  scanMiningOpportunities(true).catch((err) => console.error("[mine:scan:init]", err.message));
  scanInterval = setInterval(() => {
    scanMiningOpportunities(false).catch((err) => console.error("[mine:scan:tick]", err.message));
  }, 30 * 60 * 1000);
}

export function stopMiningOpportunityScanner() {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; console.log("[mine:scan] Stopped"); }
}