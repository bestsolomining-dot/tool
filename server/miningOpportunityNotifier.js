// server/miningOpportunityNotifier.js - Main orchestrator
import { CONFIG } from "./config.js";
import { getTrendDb, run, all } from "./db.js";
import { getCoinGeckoId, COIN_TO_COINGECKO_MAP } from "./coinGecko/coinMapping.js";
import { fetchAndSaveCoinPrices, getCoinPricesFromDb } from "./coinGecko/coinGeckoClient.js";
import { scrapeHeroMinersGlobal } from "./miners/heroMiners.js";
import { scrapeMiningDutchGlobal } from "./miners/miningDutch.js";
import { sendMineTelegram } from "./telegram/telegramClient.js";
import { getAlgorithmDisplayName } from "../src/core/mapping.js";
// import { getBtcPrice } from "./utils/priceUtils.js";

let lastNotifiedOpportunities = new Map();
let btcPriceCache = { price: 60000, timestamp: 0 };
const BTC_PRICE_TTL = 60000;

async function getBtcPrice() {
  const now = Date.now();
  if (btcPriceCache.timestamp > now - BTC_PRICE_TTL) return btcPriceCache.price;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", {
      signal: AbortSignal.timeout(3000)
    });
    const data = await res.json();
    btcPriceCache = { price: data?.bitcoin?.usd || 60000, timestamp: now };
  } catch {
    btcPriceCache = { price: 60000, timestamp: now };
  }
  return btcPriceCache.price;
}

async function fetchPrices(algos, type = "nh") {
  if (!algos || algos.length === 0) return {};
  const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
  const endpoint = type === "nh" ? "/api/v2/hashpower/order/price" : "/api/v2/mrr/rentals";
  const queryParam = type === "nh" ? "algorithm" : "algo";
  
  const settled = await Promise.allSettled(
    algos.map(async (algo) => {
      try {
        const url = type === "nh"
          ? `${baseUrl}${endpoint}?${queryParam}=${encodeURIComponent(algo)}&client=BT`
          : `${baseUrl}${endpoint}?${queryParam}=${encodeURIComponent(algo)}&limit=1`;
        const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) return [algo, 0];
        const d = await r.json();
        let price = 0;
        if (type === "nh") {
          price = parseFloat(d?.price ?? d?.fixedPrice ?? d?.marketPrice ?? 0);
        } else {
          const rental = d?.data?.rentals?.[0] || d?.data?.[0] || {};
          price = parseFloat(rental.price || rental.min_price || rental.rate || 0);
        }
        return [algo, Number.isFinite(price) ? price : 0];
      } catch { return [algo, 0]; }
    })
  );
  const results = {};
  for (const item of settled) {
    if (item.status === "fulfilled") results[item.value[0]] = item.value[1];
  }
  return results;
}

function calculateProfitability(poolBtc, nhPrice, mrrPrice, coinPrices = null) {
  const result = { vsNiceHash: null, vsMrr: null, status: "neutral", recommendation: "", profitBtc: 0, profitUsd: 0 };
  if (poolBtc > 0 && nhPrice > 0) {
    const spread = ((poolBtc - nhPrice) / nhPrice) * 100;
    result.vsNiceHash = spread;
    result.profitBtc = poolBtc - nhPrice;
    if (coinPrices?.usd) result.profitUsd = result.profitBtc * coinPrices.usd;
    if (spread > 5) { result.status = "profitable"; result.recommendation = "✅ Mine on pool, sell on NiceHash"; }
    else if (spread < -5) { result.status = "loss"; result.recommendation = "❌ Buy on NiceHash instead"; }
    else { result.status = "neutral"; result.recommendation = "➖ Break-even"; }
  }
  if (poolBtc > 0 && mrrPrice > 0) {
    result.vsMrr = ((poolBtc - mrrPrice) / mrrPrice) * 100;
  }
  return result;
}

function extractCoinNames(heroRows, dutchRows) {
  const coinNames = new Set();
  for (const row of heroRows || []) {
    if (row.coin) coinNames.add(row.coin.toUpperCase());
    if (row.subdomain) coinNames.add(row.subdomain.toUpperCase());
    if (row.algorithm) coinNames.add(row.algorithm.toUpperCase());
  }
  for (const row of dutchRows || []) {
    if (row.coin) coinNames.add(row.coin.toUpperCase());
    if (row.algorithm) coinNames.add(row.algorithm.toUpperCase());
  }
  return Array.from(coinNames);
}

async function sendOpportunityAlert(opp) {
  const emoji = opp.profitStatus === "profitable" ? "🟢" : opp.profitStatus === "loss" ? "🔴" : "🟡";
  const coinsDisplay = opp.heroCoins.slice(0, 5).join(", ");
  let priceLine = '';
  if (opp.coinPrices) {
    const usdPrice = opp.coinPrices.usd ? `$${opp.coinPrices.usd.toFixed(2)}` : 'N/A';
    const change24h = opp.coinPrices.price_change_24h !== undefined ? 
      `${opp.coinPrices.price_change_24h >= 0 ? '+' : ''}${opp.coinPrices.price_change_24h.toFixed(2)}%` : 'N/A';
    priceLine = `<b>Coin Price:</b> ${usdPrice} (24h: ${change24h})\n`;
  }
  const msg = `${emoji} <b>Mining ${opp.profitStatus.toUpperCase()}</b>\n━━━━━━━━━━━━━━━━━━\n` +
    `<b>Algo:</b> <code>${opp.label}</code>\n` +
    `<b>Pool:</b> <code>${opp.poolBtcPerDay.toFixed(8)} BTC/day</code>\n` +
    `<b>NH:</b> <code>${opp.nhPriceBtc.toFixed(8)} BTC/day</code>\n` +
    `<b>MRR:</b> <code>${(opp.mrrPriceBtc || 0).toFixed(8)} BTC/day</code>\n` +
    `<b>Spread:</b> <code>${opp.spreadPct !== null ? (opp.spreadPct >= 0 ? "+" : "") + opp.spreadPct.toFixed(2) : "N/A"}%</code>\n` +
    (opp.profitUsd ? `<b>Profit:</b> $${opp.profitUsd.toFixed(2)}\n` : '') +
    priceLine +
    `<b>Miners:</b> ${opp.poolMiners}\n` +
    `<b>Coins:</b> ${coinsDisplay || "N/A"}\n` +
    `<b>${opp.recommendation || ""}</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n<i>Updated every 15 min</i>`;
  await sendMineTelegram(msg);
}

async function sendMiningSummary(topOpps) {
  const lines = topOpps.map((o, i) => {
    const pct = o.spreadPct !== null ? (o.spreadPct >= 0 ? "+" + o.spreadPct.toFixed(2) : o.spreadPct.toFixed(2)) : "N/A";
    return `🟢 <b>${i + 1}. ${o.label}</b> — ${o.poolBtcPerDay.toFixed(8)} BTC/day (${pct}%) | ${o.poolMiners} miners`;
  });
  const msg = `📊 <b>Mining Summary</b>\n━━━━━━━━━━━━━━━━━━\n` +
    `<b>Time:</b> ${new Date().toLocaleTimeString()}\n` +
    `<b>Profitable:</b> ${topOpps.length}\n━━━━━━━━━━━━━━━━━━\n` +
    lines.join("\n") +
    `\n━━━━━━━━━━━━━━━━━━\n<i>Updated every 15 min</i>`;
  await sendMineTelegram(msg);
}

export async function scanMiningOpportunities(force = false) {
  console.log(`[mine:scan] Scanning...`);
  
  await fetchAndSaveCoinPrices(force);
  
  const btcPrice = await getBtcPrice();
  const [heroRes, dutchRes] = await Promise.all([
    scrapeHeroMinersGlobal(btcPrice),
    scrapeMiningDutchGlobal(btcPrice, force),
  ]);

  const coinNames = extractCoinNames(heroRes?.coinStats, dutchRes?.coinStats);
  const coinIdMap = new Map();
  const coinIdSet = new Set();
  for (const name of coinNames) {
    const id = getCoinGeckoId(name);
    if (id) { coinIdMap.set(name, id); coinIdSet.add(id); }
  }
  const coinPrices = await getCoinPricesFromDb(Array.from(coinIdSet));

  const algoSet = new Set();
  const addAlgos = (rows) => {
    for (const row of rows || []) {
      if (row.nicehashAlgo) algoSet.add(row.nicehashAlgo);
      if (row.normalizedAlgo && row.normalizedAlgo !== "UNKNOWN") algoSet.add(row.normalizedAlgo);
    }
  };
  addAlgos(heroRes?.coinStats);
  addAlgos(dutchRes?.coinStats);

  const algos = Array.from(algoSet).filter(Boolean);
  if (algos.length === 0) return { success: false, error: "No algos found" };

  const [nhPrices, mrrPrices] = await Promise.all([
    fetchPrices(algos, "nh"),
    fetchPrices(algos, "mrr"),
  ]);

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
  const now = new Date();

  for (const algo of algos) {
    const hero = heroByAlgo.get(algo);
    const dutch = dutchByAlgo.get(algo);
    const poolBtc = Math.max(hero?.btcPerDay || 0, dutch?.btcPerDay || 0);
    const nhPrice = nhPrices[algo] || 0;
    const mrrPrice = mrrPrices[algo] || 0;
    const spread = poolBtc > 0 && nhPrice > 0 ? ((poolBtc - nhPrice) / nhPrice) * 100 : null;
    const coinName = hero?.coins?.[0] || algo;
    const coinId = coinIdMap.get(coinName) || getCoinGeckoId(coinName, algo);
    const coinPriceData = coinId ? coinPrices[coinId] || null : null;
    const profit = calculateProfitability(poolBtc, nhPrice, mrrPrice, coinPriceData);

    opportunities.push({
      algo, label: getAlgorithmDisplayName(algo), coinName, coinId,
      poolBtcPerDay: poolBtc, nhPriceBtc: nhPrice, mrrPriceBtc: mrrPrice,
      spreadPct: spread, spreadVsMrr: profit.vsMrr,
      poolMiners: Math.max(hero?.miners || 0, dutch?.miners || 0),
      source: poolBtc > 0 ? (dutch?.btcPerDay > hero?.btcPerDay ? "Mining-Dutch" : "HeroMiners") : "N/A",
      heroCoins: hero?.coins || [], heroSubdomains: hero?.subdomains || [],
      profitStatus: profit.status, recommendation: profit.recommendation,
      profitBtc: profit.profitBtc, profitUsd: profit.profitUsd,
      coinPrices: coinPriceData, time: now.toLocaleTimeString()
    });
  }

  opportunities.sort((a, b) => (b.spreadPct ?? -Infinity) - (a.spreadPct ?? -Infinity));

  const db = await getTrendDb();
  const capturedAt = now.toISOString();
  const notifyMessages = [];

  for (const opp of opportunities) {
    await run(db,
      `INSERT INTO mining_opportunities (algo, captured_at, pool_btc_per_day, nh_price_btc, mrr_price_btc, spread_pct, spread_vs_mrr, pool_miners, profit_status, coin_name, coin_id, coin_prices_json, summary_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [opp.algo, capturedAt, opp.poolBtcPerDay, opp.nhPriceBtc, opp.mrrPriceBtc,
       opp.spreadPct ?? 0, opp.spreadVsMrr ?? 0, opp.poolMiners, opp.profitStatus,
       opp.coinName || null, opp.coinId || null, JSON.stringify(opp.coinPrices || {}), JSON.stringify(opp)]
    );
    if (opp.spreadPct !== null && opp.spreadPct >= CONFIG.SPREAD_THRESHOLD_PCT && opp.poolBtcPerDay > 0) {
      const lastNotified = lastNotifiedOpportunities.get(opp.algo) || 0;
      if (Date.now() - lastNotified > CONFIG.MIN_NOTIFY_INTERVAL_MS || force) {
        lastNotifiedOpportunities.set(opp.algo, Date.now());
        notifyMessages.push(opp);
      }
    }
  }

  if (notifyMessages.length > 0) {
    for (const opp of notifyMessages) await sendOpportunityAlert(opp);
  }

  const profitable = opportunities.filter((o) => o.profitStatus === "profitable");
  if (profitable.length > 0) await sendMiningSummary(profitable.slice(0, 10));

  return {
    success: true, scannedAt: capturedAt, totalAlgos: algos.length,
    opportunities: opportunities.slice(0, 20), notificationsSent: notifyMessages.length,
    profitableCount: profitable.length, heroCoins: heroRes?.coinStats?.length || 0,
    dutchCoins: dutchRes?.coinStats?.length || 0
  };
}

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

export async function getMiningStatus() {
  try {
    const db = await getTrendDb();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const stats = await all(db,
      `SELECT COUNT(*) as total, 
        SUM(CASE WHEN profit_status = 'profitable' THEN 1 ELSE 0 END) as profitable,
        SUM(CASE WHEN profit_status = 'loss' THEN 1 ELSE 0 END) as loss,
        SUM(CASE WHEN profit_status = 'neutral' THEN 1 ELSE 0 END) as neutral,
        AVG(spread_pct) as avg_spread, MAX(spread_pct) as max_spread,
        SUM(pool_miners) as total_miners
       FROM mining_opportunities WHERE captured_at >= ?`, [oneHourAgo]
    );
    const latest = await all(db,
      `SELECT algo, coin_name, coin_id, pool_btc_per_day, spread_pct, profit_status, pool_miners
       FROM mining_opportunities WHERE captured_at >= ? AND spread_pct IS NOT NULL
       ORDER BY spread_pct DESC LIMIT 10`, [oneHourAgo]
    );
    const coinPrices = await getCoinPricesFromDb();
    return { success: true, timestamp: new Date().toISOString(), summary: stats[0] || {}, topOpportunities: latest, coinPrices };
  } catch (err) { return { success: false, error: err.message }; }
}

export async function sendMiningStatus() {
  const status = await getMiningStatus();
  if (!status.success) return status;
  const s = status.summary;
  const msg = `${s.profitable > 0 ? "🟢" : "🔴"} <b>Mining System Status</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n<b>Time:</b> ${new Date().toLocaleString()}\n` +
    `<b>Algos:</b> ${s.total}\n<b>Miners:</b> ${(s.total_miners || 0).toLocaleString()}\n` +
    `━━━━━━━━━━━━━━━━━━\n<b>Profitability:</b>\n  🟢 Profitable: ${s.profitable}\n  🟡 Neutral: ${s.neutral}\n  🔴 Loss: ${s.loss}\n` +
    `━━━━━━━━━━━━━━━━━━\n<b>Stats:</b>\n  📊 Avg Spread: ${(s.avg_spread || 0).toFixed(2)}%\n  📈 Max Spread: ${(s.max_spread || 0).toFixed(2)}%\n` +
    `━━━━━━━━━━━━━━━━━━\n<i>System scans every 15 minutes</i>`;
  await sendMineTelegram(msg);
  return { success: true };
}

let scanInterval = null;
let coinPriceInterval = null;

export function startMiningOpportunityScanner() {
  if (scanInterval) return;
  console.log("[mine:scan] Starting scanner (every 15 min)");
  scanMiningOpportunities(true).catch(() => {});
  scanInterval = setInterval(() => scanMiningOpportunities(false).catch(() => {}), CONFIG.SCAN_INTERVAL_MS);
}

export function stopMiningOpportunityScanner() {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
}