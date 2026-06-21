// server/miners/miningDutch.js
import { COMMON_HEADERS } from "../config.js";
import { normalizeAlgo } from "../../src/core/mapping.js";
import { getBtcPrice } from "../utils/priceUtils.js";

let dutchCache = { data: null, timestamp: 0 };
const DUTCH_CACHE_TTL = 120000;

export async function scrapeMiningDutchGlobal(btcPrice, force = false) {
  const now = Date.now();
  if (!force && dutchCache.data && now - dutchCache.timestamp < DUTCH_CACHE_TTL) {
    return dutchCache.data;
  }

  try {
    const apiRes = await fetch(
      "https://www.mining-dutch.nl/api/v1/public/multiport/?method=avgprofitability",
      { headers: COMMON_HEADERS, signal: AbortSignal.timeout(5000) }
    );

    let coinStats = [];
    if (apiRes.ok) {
      const json = await apiRes.json();
      if (json?.success && json?.result) {
        coinStats = Object.entries(json.result).map(([algorithm, data]) => {
          const btcPerDay = parseFloat(data.expected || data.average || 0);
          return {
            algorithm,
            normalizedAlgo: normalizeAlgo(algorithm),
            nicehashAlgo: algorithm.toUpperCase(),
            coin: algorithm.toUpperCase(),
            miners: 0,
            btcPerDay: Number.isFinite(btcPerDay) ? btcPerDay : 0,
            usdPerDay: Number.isFinite(btcPerDay) ? btcPerDay * btcPrice : 0,
            hashrate: "N/A",
          };
        });
      }
    }

    const result = { success: true, coinStats };
    dutchCache = { data: result, timestamp: now };
    return result;
  } catch (err) {
    console.error("[Mining-Dutch] Error:", err.message);
    return { success: false, error: err.message, coinStats: [] };
  }
}