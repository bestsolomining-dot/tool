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
//  Scrape HeroMiners
// =========================
export async function scrapeHeroMinersGlobal(force = true) {
  try {
    const res = await fetch("https://herominers.com/sitemap.xml", {
      headers: COMMON_HEADERS, signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Hero sitemap: ${res.status}`);
    const xml = await res.text();
    const poolHosts = [...new Set(
      [...xml.matchAll(/https:\/\/([a-z0-9-]+)\.herominers\.com\//gi)]
        .map((m) => m[1]).filter((h) => h && h !== "herominers")
    )].sort();
    if (poolHosts.length === 0) throw new Error("No pool hosts found");

    const settled = await Promise.allSettled(
      poolHosts.map(async (host) => {
        const r = await fetch(`https://${host}.herominers.com/api/stats`, {
          headers: COMMON_HEADERS, signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) throw new Error(`${host} ${r.status}`);
        return { host, data: await r.json() };
      })
    );

    const coinStats = [];
    for (const item of settled) {
      if (item.status !== "fulfilled") continue;
      const { host, data } = item.value;
      const config = data?.config || {};
      const pool = data?.pool || {};
      const algo = String(config.cnAlgorithm || config.algorithm || host).trim();
      const priceBtc = parseFloat(pool.price?.btc ?? pool.price?.BTC ?? 0);
      const miners = parseInt(pool.miners || 0) + parseInt(pool.soloMiners || 0);
      coinStats.push({
        coin: String(config.symbol || host).toUpperCase(),
        host, algorithm: algo,
        normalizedAlgo: normalizeAlgo(algo),
        miners, btcPerDay: priceBtc,
      });
    }
    return { success: true, coinStats };
  } catch (err) {
    console.error("[mine:hero]", err.message);
    return { success: false, error: err.message, coinStats: [] };
  }
}

// =========================
//  Scrape Mining-Dutch
// =========================
export async function scrapeMiningDutchGlobal(force = false) {
  try {
    const res = await fetch("https://www.mining-dutch.nl/", {
      headers: COMMON_HEADERS, signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Dutch: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const coinStats = [];
    const nowMiningTable = $('h4:contains("Currently Mining")').next("table");
    nowMiningTable.find("tbody > tr").each((i, el) => {
      const tds = $(el).find("td");
      if (tds.length < 5) return;
      const algo = $(tds[0]).text().trim();
      const miners = parseInt($(tds[1]).text().trim(), 10) || 0;
      const btcPerDay = parseFloat($(tds[2]).text().trim().split(" ")[0]) || 0;
      const existing = coinStats.find((c) => c.algorithm === algo);
      if (existing) { existing.btcPerDay = Math.max(existing.btcPerDay, btcPerDay); existing.miners += miners; }
      else coinStats.push({ algorithm: algo, normalizedAlgo: normalizeAlgo(algo), miners, btcPerDay });
    });
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
  }
  for (const row of dutchRes?.coinStats || []) {
    if (row.normalizedAlgo && row.normalizedAlgo !== "UNKNOWN") algoSet.add(row.normalizedAlgo);
  }

  const algos = Array.from(algoSet).filter(Boolean);
  if (algos.length === 0) return { success: false, error: "No algos found" };

  const nhPrices = await fetchNhPrices(algos);

  const heroByAlgo = new Map();
  for (const row of heroRes?.coinStats || []) {
    const k = row.normalizedAlgo;
    if (!heroByAlgo.has(k)) heroByAlgo.set(k, { btcPerDay: 0, miners: 0 });
    const cur = heroByAlgo.get(k);
    cur.btcPerDay = Math.max(cur.btcPerDay, row.btcPerDay);
    cur.miners += row.miners || 0;
  }

  const dutchByAlgo = new Map();
  for (const row of dutchRes?.coinStats || []) {
    const k = row.normalizedAlgo;
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
      label: getDisplayName(algo),
      poolBtcPerDay: poolBtc,
      nhPriceBtc: nhPrice,
      spreadPct: spread,
      poolMiners: Math.max(hero?.miners || 0, dutch?.miners || 0),
      source: poolBtc > 0 ? (dutch?.btcPerDay > hero?.btcPerDay ? "Mining-Dutch" : "HeroMiners") : "N/A",
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

  return { success: true, scannedAt: capturedAt, totalAlgos: algos.length, opportunities: opportunities.slice(0, 20), notificationsSent: notifyMessages.length, positiveCount };
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