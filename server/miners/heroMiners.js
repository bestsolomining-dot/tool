// server/miners/heroMiners.js
import { COMMON_HEADERS, CONFIG } from "../config.js";
import { normalizeAlgo } from "../../src/core/mapping.js";
import { getBtcPrice } from "../utils/priceUtils.js";

const HERO_CACHE = new Map();
const HERO_CACHE_TTL = 60000;

const COIN_TO_ALGO_MAP = {
  ergo: "autolykos", salvium: "randomx", etc: "etchash",
  aipg: "aipg", karlsen: "kheavyhash", clore: "kawpow",
  neoxa: "kawpow", nexa: "nexapow", rvn: "kawpow",
  kaspa: "kheavyhash", beam: "beamv3", zeph: "randomx",
  iron: "fishhash", dynex: "dynexsolve", alephium: "blake3",
};

async function discoverHeroMinersSubdomains() {
  const cacheKey = "hero_subdomains";
  const cached = HERO_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < HERO_CACHE_TTL) return cached.data;

  const discovered = new Set();
  try {
    const res = await fetch("https://herominers.com/sitemap.xml", {
      headers: COMMON_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const xml = await res.text();
      const matches = [...xml.matchAll(/https:\/\/([a-z0-9-]+)\.herominers\.com\//gi)];
      for (const match of matches) {
        const subdomain = match[1];
        if (subdomain && subdomain !== "herominers" && !subdomain.includes("www") &&
            !subdomain.includes("api") && !subdomain.includes("pool") &&
            !subdomain.includes("support") && !subdomain.includes("blog")) {
          discovered.add(subdomain);
        }
      }
    }
  } catch (err) {
    ["ergo", "salvium", "etc", "aipg", "karlsen", "clore", "neoxa", "nexa", "rvn", "kaspa", "beam", "zeph", "iron", "dynex", "alephium"]
      .forEach(c => discovered.add(c));
  }

  const result = Array.from(discovered);
  HERO_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

async function scrapeHeroMinersCoin(coin, btcPrice) {
  const cacheKey = `hero_${coin}`;
  const cached = HERO_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < HERO_CACHE_TTL) return cached.data;

  try {
    const url = `https://${coin}.herominers.com/api/stats`;
    const response = await fetch(url, {
      headers: { ...COMMON_HEADERS, Accept: "application/json" },
      signal: AbortSignal.timeout(CONFIG.REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      HERO_CACHE.set(cacheKey, { data: [], timestamp: Date.now() });
      return [];
    }
    const data = await response.json();
    const rows = parseHeroMinersApiData(data, coin, btcPrice);
    HERO_CACHE.set(cacheKey, { data: rows, timestamp: Date.now() });
    return rows;
  } catch {
    HERO_CACHE.set(cacheKey, { data: [], timestamp: Date.now() });
    return [];
  }
}

function parseHeroMinersApiData(data, coin, btcPrice) {
  const rows = [];
  const pool = data?.pool || data;
  const config = data?.config || {};
  if (pool) {
    const coinName = String(config.symbol || coin).toUpperCase();
    const miners = parseInt(pool.miners || pool.workers || 0);
    const hashrate = pool.hashrate || pool.poolHashrate || "N/A";
    const btcPerDay = parseFloat(pool.price?.btc || pool.price?.BTC || 0);
    const algorithm = COIN_TO_ALGO_MAP[coin] || coin;
    if (miners > 0 || btcPerDay > 0) {
      rows.push({
        algorithm, coin: coinName, subdomain: coin, miners,
        hashrate: String(hashrate), btcPerDay,
        usdPerDay: btcPerDay * btcPrice,
        normalizedAlgo: normalizeAlgo(algorithm),
        nicehashAlgo: algorithm.toUpperCase(),
      });
    }
  }
  return rows;
}

export async function scrapeHeroMinersGlobal(btcPrice) {
  try {
    const coins = await discoverHeroMinersSubdomains();
    const results = [];
    const chunks = [];
    for (let i = 0; i < coins.length; i += CONFIG.MAX_CONCURRENT_FETCHES) {
      chunks.push(coins.slice(i, i + CONFIG.MAX_CONCURRENT_FETCHES));
    }
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(chunk.map((coin) => scrapeHeroMinersCoin(coin, btcPrice)));
      results.push(...chunkResults.flat());
    }
    const allCoinStats = results.flat();
    const totalMiners = allCoinStats.reduce((sum, r) => sum + (r.miners || 0), 0);
    return { success: true, coinStats: allCoinStats, miners: totalMiners, coinsScraped: coins.length };
  } catch (err) {
    console.error("[HeroMiners] Error:", err.message);
    return { success: false, error: err.message, coinStats: [] };
  }
}

// Export all functions that might be needed elsewhere
export {
  scrapeHeroMinersCoin,
  discoverHeroMinersSubdomains,
  parseHeroMinersApiData,
};