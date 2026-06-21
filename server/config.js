// server/config.js
import path from 'path';

export const CONFIG = {
  SCAN_INTERVAL_MS: 15 * 60 * 1000,
  MIN_NOTIFY_INTERVAL_MS: 15 * 60 * 1000,
  SPREAD_THRESHOLD_PCT: 5,
  TREND_WINDOW_HOURS: 24,
  MAX_CONCURRENT_FETCHES: 5,
  REQUEST_TIMEOUT_MS: 8000,
  CACHE_TTL_MS: 30000,
  COINGECKO_CACHE_TTL: 60000,
  COINGECKO_PRICE_TTL: 300000,
};

export const COMMON_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json,text/html",
  "Accept-Encoding": "gzip, deflate",
  "Cache-Control": "no-cache",
};

export const DATA_DIR = path.resolve(process.cwd(), "data");
export const TRENDS_DB_PATH = path.join(DATA_DIR, "mining_trends.db");
