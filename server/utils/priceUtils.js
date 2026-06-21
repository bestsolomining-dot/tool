// server/utils/priceUtils.js
// Centralized price fetching utilities

let btcPriceCache = { price: 60000, timestamp: 0 };
const BTC_PRICE_TTL = 60000; // 1 minute

/**
 * Get current BTC price in USD with caching
 */
export async function getBtcPrice() {
  const now = Date.now();
  if (btcPriceCache.timestamp > now - BTC_PRICE_TTL) {
    return btcPriceCache.price;
  }

  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      {
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    btcPriceCache = { price: data?.bitcoin?.usd || 60000, timestamp: now };
  } catch (err) {
    console.warn("[BTC Price] Failed to fetch, using fallback:", err.message);
    btcPriceCache = { price: 60000, timestamp: now };
  }
  return btcPriceCache.price;
}

/**
 * Clear BTC price cache (force refresh on next call)
 */
export function clearBtcPriceCache() {
  btcPriceCache = { price: 60000, timestamp: 0 };
  console.log("[BTC Price] Cache cleared");
}