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
  "Cache-Control": "no-cache"
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
//  HERO MINERS - Comprehensive Scraper with Coin Discovery
// =========================

// Coin to algorithm mappings
const COIN_TO_ALGO_MAP = {
  'ergo': 'autolykos',
  'salvium': 'randomx',
  'etc': 'etchash',
  'aipg': 'aipg',
  'karlsen': 'kheavyhash',
  'clore': 'kawpow',
  'neoxa': 'kawpow',
  'nexa': 'nexapow',
  'rvn': 'kawpow',
  'kaspa': 'kheavyhash',
  'beam': 'beamv3',
  'zeph': 'randomx',
  'iron': 'fishhash',
  'dynex': 'dynexsolve',
  'alephium': 'blake3',
  'octopus': 'octopus',
  'verus': 'verushash',
  'xelis': 'xelishashv3',
  'zano': 'progpowz',
  'pearl': 'pearlhash',
  'x11': 'x11',
  'lyra': 'lyra2rev2',
  'neoscrypt': 'neoscrypt',
  'yespower': 'yespower',
  'argon2': 'argon2',
  'mtp': 'mtp'
};

// Algorithm to coin mapping (reverse lookup)
const ALGO_TO_COIN_MAP = Object.entries(COIN_TO_ALGO_MAP).reduce((acc, [coin, algo]) => {
  if (!acc[algo]) acc[algo] = [];
  acc[algo].push(coin);
  return acc;
}, {});

// Known working coins (fallback if discovery fails)
const KNOWN_COINS = [
  'ergo', 'salvium', 'etc', 'aipg', 'karlsen',
  'clore', 'neoxa', 'nexa', 'rvn', 'kaspa',
  'beam', 'zeph', 'iron', 'dynex', 'alephium'
];

/**
 * Discover HeroMiners subdomains from sitemap
 */
async function discoverHeroMinersSubdomains() {
  const discovered = new Set();
  
  try {
    // Method 1: Sitemap
    const res = await fetch('https://herominers.com/sitemap.xml', {
      headers: COMMON_HEADERS,
      signal: AbortSignal.timeout(15000)
    });
    
    if (res.ok) {
      const xml = await res.text();
      // Extract all subdomains from sitemap URLs
      const matches = [...xml.matchAll(/https:\/\/([a-z0-9-]+)\.herominers\.com\//gi)];
      
      for (const match of matches) {
        const subdomain = match[1];
        // Filter out main domain and common non-coin subdomains
        if (subdomain && 
            subdomain !== 'herominers' && 
            !subdomain.includes('www') &&
            !subdomain.includes('api') &&
            !subdomain.includes('pool') &&
            !subdomain.includes('support') &&
            !subdomain.includes('blog')) {
          discovered.add(subdomain);
        }
      }
      console.log(`[HeroMiners] Found ${discovered.size} coins from sitemap`);
    }
  } catch (err) {
    console.log('[HeroMiners] Sitemap discovery failed:', err.message);
  }
  
  // Method 2: Try to get from homepage
  if (discovered.size < 5) {
    try {
      const res = await fetch('https://herominers.com/', {
        headers: COMMON_HEADERS,
        signal: AbortSignal.timeout(10000)
      });
      
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        
        // Look for pool links
        $('a[href*="herominers.com"]').each((i, el) => {
          const href = $(el).attr('href');
          if (href) {
            const match = href.match(/https?:\/\/([a-z0-9-]+)\.herominers\.com/);
            if (match && match[1] && 
                match[1] !== 'herominers' && 
                !match[1].includes('www')) {
              discovered.add(match[1]);
            }
          }
        });
        console.log(`[HeroMiners] Found ${discovered.size} coins from homepage`);
      }
    } catch (err) {
      console.log('[HeroMiners] Homepage discovery failed:', err.message);
    }
  }
  
  // Method 3: Try to get from pool list API
  if (discovered.size < 5) {
    try {
      const res = await fetch('https://herominers.com/api/pools', {
        headers: COMMON_HEADERS,
        signal: AbortSignal.timeout(10000)
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data)) {
          data.forEach(pool => {
            if (pool.coin) discovered.add(pool.coin.toLowerCase());
            if (pool.subdomain) discovered.add(pool.subdomain.toLowerCase());
          });
        }
      }
    } catch (err) {
      console.log('[HeroMiners] Pools API failed:', err.message);
    }
  }
  
  // Add known coins as fallback
  if (discovered.size === 0) {
    KNOWN_COINS.forEach(c => discovered.add(c));
    console.log(`[HeroMiners] Using ${KNOWN_COINS.length} fallback coins`);
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
 * Map coin to algorithm
 */
function mapCoinToAlgorithm(coin) {
  return COIN_TO_ALGO_MAP[coin] || coin;
}

/**
 * Scrape a single coin subdomain
 */
async function scrapeHeroMinersCoin(coin, btcPrice) {
  try {
    // Try API endpoint first
    const url = `https://${coin}.herominers.com/api/stats`;
    const response = await fetch(url, {
      headers: {
        ...COMMON_HEADERS,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });
    
    if (response.ok) {
      const data = await response.json();
      return parseHeroMinersApiData(data, coin, btcPrice);
    }
    
    // Fallback: Try HTML page
    const htmlUrl = `https://${coin}.herominers.com/`;
    const htmlRes = await fetch(htmlUrl, {
      headers: COMMON_HEADERS,
      signal: AbortSignal.timeout(10000)
    });
    
    if (htmlRes.ok) {
      const html = await htmlRes.text();
      return parseHeroMinersHtml(html, coin, btcPrice);
    }
    
    return [];
  } catch (err) {
    return [];
  }
}

/**
 * Parse HeroMiners API data
 */
function parseHeroMinersApiData(data, coin, btcPrice) {
  const rows = [];
  const pool = data?.pool || data;
  const config = data?.config || {};
  
  if (pool) {
    const coinName = String(config.symbol || coin).toUpperCase();
    const miners = parseInt(pool.miners || pool.workers || 0);
    const hashrate = pool.hashrate || pool.poolHashrate || 'N/A';
    const btcPerDay = parseFloat(pool.price?.btc || pool.price?.BTC || 0);
    const algorithm = mapCoinToAlgorithm(coin);
    
    if (miners > 0 || btcPerDay > 0) {
      rows.push({
        algorithm,
        coin: coinName,
        subdomain: coin,
        miners,
        hashrate: String(hashrate),
        btcPerDay,
        usdPerDay: btcPerDay * btcPrice,
        normalizedAlgo: normalizeAlgo(algorithm),
        nicehashAlgo: algorithm.toUpperCase()
      });
    }
  }
  
  // Handle multiple coins in response
  const coins = data?.coins || data?.data?.coins;
  if (coins && typeof coins === 'object') {
    for (const [coinName, info] of Object.entries(coins)) {
      if (typeof info === 'object' && info !== null) {
        const miners = parseInt(info.miners || info.workers || 0);
        const btcPerDay = parseFloat(info.btcPerDay || info.expected || 0);
        const algorithm = mapCoinToAlgorithm(coin);
        
        if (miners > 0 || btcPerDay > 0) {
          rows.push({
            algorithm,
            coin: coinName.toUpperCase(),
            subdomain: coin,
            miners,
            hashrate: String(info.hashrate || info.poolHashrate || 'N/A'),
            btcPerDay,
            usdPerDay: btcPerDay * btcPrice,
            normalizedAlgo: normalizeAlgo(algorithm),
            nicehashAlgo: algorithm.toUpperCase()
          });
        }
      }
    }
  }
  
  return rows;
}

/**
 * Parse HeroMiners HTML
 */
function parseHeroMinersHtml(html, coin, btcPrice) {
  const rows = [];
  const $ = cheerio.load(html);
  const algorithm = mapCoinToAlgorithm(coin);
  
  // Look for tables with mining data
  $('table').each((i, table) => {
    $(table).find('tbody > tr').each((j, row) => {
      const tds = $(row).find('td');
      if (tds.length >= 3) {
        const coinName = $(tds[0]).text().trim() || coin.toUpperCase();
        const miners = parseInt($(tds[1]).text().replace(/,/g, '')) || 0;
        const hashrate = $(tds[2]).text().trim() || 'N/A';
        const btcPerDay = parseFloat($(tds[3])?.text()?.replace(/[^0-9.]/g, '') || 0);
        
        if (coinName !== 'Unknown' || miners > 0 || btcPerDay > 0) {
          rows.push({
            algorithm,
            coin: coinName,
            subdomain: coin,
            miners,
            hashrate,
            btcPerDay,
            usdPerDay: btcPerDay * btcPrice,
            normalizedAlgo: normalizeAlgo(algorithm),
            nicehashAlgo: algorithm.toUpperCase()
          });
        }
      }
    });
  });
  
  // If no table, try script tags with JSON
  if (rows.length === 0) {
    $('script').each((i, script) => {
      const content = $(script).html();
      if (content) {
        const match = content.match(/(?:var|let|const)\s+(?:data|stats|pool)\s*=\s*({[\s\S]*?});/);
        if (match) {
          try {
            const data = JSON.parse(match[1]);
            const jsonRows = parseHeroMinersApiData(data, coin, btcPrice);
            rows.push(...jsonRows);
          } catch (e) {
            // JSON parsing failed
          }
        }
      }
    });
  }
  
  return rows;
}

/**
 * Scrape all HeroMiners coins
 */
export async function scrapeHeroMinersGlobal(force = true) {
  try {
    console.log('[HeroMiners] Starting comprehensive scrape...');
    const btcPrice = await getBtcPrice();
    console.log(`[HeroMiners] BTC Price: $${btcPrice}`);
    
    // Discover all coin subdomains
    const coins = await discoverHeroMinersSubdomains();
    console.log(`[HeroMiners] Discovered ${coins.length} coins: ${coins.slice(0, 20).join(', ')}${coins.length > 20 ? `... +${coins.length - 20} more` : ''}`);
    
    const allCoinStats = [];
    let totalMiners = 0;
    let successfulCoins = 0;
    
    for (const coin of coins) {
      try {
        const rows = await scrapeHeroMinersCoin(coin, btcPrice);
        
        if (rows && rows.length > 0) {
          allCoinStats.push(...rows);
          const coinMiners = rows.reduce((sum, r) => sum + (r.miners || 0), 0);
          totalMiners += coinMiners;
          successfulCoins++;
          const algo = rows[0]?.algorithm || coin;
          console.log(`[HeroMiners] ✓ ${coin} (${algo}): ${rows.length} entries, ${coinMiners} miners`);
        } else {
          console.log(`[HeroMiners] ✗ ${coin}: No data found`);
        }
        
        // Rate limiting - be respectful
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.log(`[HeroMiners] ✗ ${coin}: Error - ${err.message}`);
      }
    }
    
    console.log(`[HeroMiners] Complete: ${successfulCoins}/${coins.length} coins, ${allCoinStats.length} entries, ${totalMiners} total miners`);
    
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
      coinsScraped: successfulCoins,
      totalCoins: coins.length,
      totalEntries: allCoinStats.length
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
            const algoLower = algorithm.toLowerCase();
            return {
              algorithm: algorithm,
              normalizedAlgo: normalizeAlgo(algorithm),
              nicehashAlgo: algorithm.toUpperCase(),
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
                nicehashAlgo: algorithm.toUpperCase(),
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
    if (!heroByAlgo.has(k)) heroByAlgo.set(k, { btcPerDay: 0, miners: 0, coins: [], subdomains: [] });
    const cur = heroByAlgo.get(k);
    cur.btcPerDay = Math.max(cur.btcPerDay, row.btcPerDay);
    cur.miners += row.miners || 0;
    if (row.coin) cur.coins.push(row.coin);
    if (row.subdomain) cur.subdomains.push(row.subdomain);
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
      heroCoins: hero?.coins || [],
      heroSubdomains: hero?.subdomains || []
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
    dutchCoins: dutchRes?.coinStats?.length || 0,
    heroMiners: heroRes?.miners || 0,
    dutchMiners: dutchRes?.miners || 0
  };
}

// =========================
//  Alerts & Summary
// =========================
async function sendOpportunityAlerts(opportunities) {
  for (const opp of opportunities) {
    const emoji = opp.spreadPct >= 20 ? "🔥" : opp.spreadPct >= 10 ? "💰" : "✅";
    const trendEmoji = opp.trend?.direction === "improving" ? "📈" : opp.trend?.direction === "declining" ? "📉" : "➡️";
    const coinsDisplay = opp.heroCoins.length > 0 ? opp.heroCoins.slice(0, 5).join(', ') : 'N/A';
    const subdomainDisplay = opp.heroSubdomains.length > 0 ? opp.heroSubdomains.slice(0, 3).join(', ') : '';
    
    const msg = `${emoji} <b>Mining Opportunity</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `<b>Algo:</b> <code>${opp.label}</code>\n` +
      `<b>Pool Revenue:</b> <code>${opp.poolBtcPerDay.toFixed(8)} BTC/day</code>\n` +
      `<b>NiceHash Cost:</b> <code>${opp.nhPriceBtc.toFixed(8)} BTC/day</code>\n` +
      `<b>Spread:</b> <code>${opp.spreadPct >= 0 ? "+" : ""}${opp.spreadPct.toFixed(2)}%</code>\n` +
      `<b>Source:</b> ${opp.source}\n` +
      `<b>Miners:</b> ${opp.poolMiners}\n` +
      (opp.heroCoins.length > 0 ? `<b>Coins:</b> ${coinsDisplay}${opp.heroCoins.length > 5 ? ` +${opp.heroCoins.length - 5}` : ''}\n` : '') +
      (subdomainDisplay ? `<b>Pools:</b> ${subdomainDisplay}\n` : '') +
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