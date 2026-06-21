// server/coinGecko/coinGeckoClient.js
import { COMMON_HEADERS, CONFIG } from "../config.js";
import { getTrendDb, run, all } from "../db.js";
import { COIN_TO_COINGECKO_MAP, TRACKED_COINS, getCoinGeckoId } from "./coinMapping.js";

const coinGeckoCache = new Map();
let lastCoinPriceUpdate = 0;

export async function fetchAndSaveCoinPrices(force = false) {
  const now = Date.now();
  if (!force && (now - lastCoinPriceUpdate) < CONFIG.COINGECKO_PRICE_TTL) {
    return { success: true, cached: true };
  }
  
  try {
    console.log('[CoinGecko] Fetching coin prices...');
    const db = await getTrendDb();
    const capturedAt = new Date().toISOString();
    
    const allIds = new Set(TRACKED_COINS);
    for (const id of Object.values(COIN_TO_COINGECKO_MAP)) {
      if (id) allIds.add(id);
    }
    const coinIds = Array.from(allIds);
    
    const batchSize = 100;
    const batches = [];
    for (let i = 0; i < coinIds.length; i += batchSize) {
      batches.push(coinIds.slice(i, i + batchSize));
    }
    
    let totalUpdated = 0;
    
    for (const batch of batches) {
      try {
        const ids = batch.join(',');
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,btc&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) continue;
        const data = await res.json();
        
        for (const [coinId, priceData] of Object.entries(data)) {
          await run(db,
            `INSERT OR REPLACE INTO coin_prices 
             (coin_id, coin_name, symbol, price_usd, price_btc, market_cap, volume_24h, price_change_24h, captured_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [coinId, null, null, priceData.usd || 0, priceData.btc || 0, 
             priceData.usd_market_cap || 0, priceData.usd_24h_vol || 0, 
             priceData.usd_24h_change || 0, capturedAt]
          );
          totalUpdated++;
        }
        coinGeckoCache.set('prices', { data, timestamp: now });
      } catch (err) {
        console.warn('[CoinGecko] Batch error:', err.message);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    
    lastCoinPriceUpdate = now;
    return { success: true, updated: totalUpdated, timestamp: capturedAt };
  } catch (err) {
    console.error('[CoinGecko] Failed:', err.message);
    return { success: false, error: err.message };
  }
}

export async function getCoinPricesFromDb(coinIds = null, limit = 100) {
  try {
    const db = await getTrendDb();
    let query = `
      SELECT coin_id, coin_name, symbol, price_usd, price_btc, 
             market_cap, volume_24h, price_change_24h, captured_at
      FROM coin_prices 
      WHERE captured_at = (SELECT MAX(captured_at) FROM coin_prices cp2 WHERE cp2.coin_id = coin_prices.coin_id)
    `;
    const params = [];
    if (coinIds && coinIds.length > 0) {
      query += ` AND coin_id IN (${coinIds.map(() => '?').join(',')})`;
      params.push(...coinIds);
    }
    query += ` LIMIT ?`;
    params.push(limit);
    
    const rows = await all(db, query, params);
    const result = {};
    for (const row of rows) {
      result[row.coin_id] = {
        usd: row.price_usd || 0,
        btc: row.price_btc || 0,
        market_cap: row.market_cap || 0,
        volume_24h: row.volume_24h || 0,
        price_change_24h: row.price_change_24h || 0,
        coin_name: row.coin_name,
        symbol: row.symbol,
        last_updated: row.captured_at
      };
    }
    return result;
  } catch (err) {
    console.error('[CoinGecko] Get prices error:', err.message);
    return {};
  }
}

export async function getCoinMetadata() {
  try {
    const db = await getTrendDb();
    return await all(db, `SELECT * FROM coin_metadata ORDER BY coin_name`);
  } catch (err) {
    console.error('[CoinGecko] Get metadata error:', err.message);
    return [];
  }
}