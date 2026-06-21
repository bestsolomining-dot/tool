// This module acts as a singleton for the database connection.
// The 'db' instance is initialized and exported from index.js
// to ensure the entire application uses the same connection.
// server/database/db.js
import path from "path";
import fs from "node:fs/promises";
import sqlite3 from "sqlite3";
import { DATA_DIR, TRENDS_DB_PATH } from "./config.js";

let opportunityDb = null;
let dbInitPromise = null;

async function updateMiningOpportunitiesTable() {
  const db = await getTrendDb();
  
  // Check if profit_status column exists
  const columns = await all(db, "PRAGMA table_info(mining_opportunities)");
  const hasProfitStatus = columns.some(c => c.name === 'profit_status');
  
  if (!hasProfitStatus) {
    console.log('[DB] Adding missing columns to mining_opportunities...');
    
    // Add all missing columns
    await run(db, "ALTER TABLE mining_opportunities ADD COLUMN profit_status TEXT DEFAULT 'neutral'");
    await run(db, "ALTER TABLE mining_opportunities ADD COLUMN trend_direction TEXT DEFAULT 'stable'");
    await run(db, "ALTER TABLE mining_opportunities ADD COLUMN coin_name TEXT");
    await run(db, "ALTER TABLE mining_opportunities ADD COLUMN coin_id TEXT");
    await run(db, "ALTER TABLE mining_opportunities ADD COLUMN coin_prices_json TEXT");
    await run(db, "ALTER TABLE mining_opportunities ADD COLUMN summary_json TEXT");
    await run(db, "ALTER TABLE mining_opportunities ADD COLUMN spread_vs_mrr REAL DEFAULT 0");
    
    console.log('[DB] Columns added successfully');
  }
}

export async function getTrendDb() {
  if (opportunityDb) return opportunityDb;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const db = await new Promise((resolve, reject) => {
      const d = new sqlite3.Database(TRENDS_DB_PATH, (err) => {
        if (err) return reject(err);
        resolve(d);
      });
    });

    await run(db, "PRAGMA journal_mode = WAL");
    await run(db, "PRAGMA synchronous = NORMAL");
    await run(db, "PRAGMA cache_size = 10000");
    
    await run(db, `CREATE TABLE IF NOT EXISTS mining_opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      algo TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      pool_btc_per_day REAL DEFAULT 0,
      nh_price_btc REAL DEFAULT 0,
      mrr_price_btc REAL DEFAULT 0,
      spread_pct REAL DEFAULT 0,
      spread_vs_mrr REAL DEFAULT 0,
      pool_miners INTEGER DEFAULT 0,
      profit_status TEXT DEFAULT 'neutral',
      trend_direction TEXT DEFAULT 'stable',
      coin_name TEXT,
      coin_id TEXT,
      coin_prices_json TEXT,
      summary_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    
    await run(db, `CREATE TABLE IF NOT EXISTS coin_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coin_id TEXT NOT NULL,
      coin_name TEXT,
      symbol TEXT,
      price_usd REAL,
      price_btc REAL,
      market_cap REAL,
      volume_24h REAL,
      price_change_24h REAL,
      captured_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(coin_id, captured_at)
    )`);
    
    await run(db, `CREATE TABLE IF NOT EXISTS coin_metadata (
      coin_id TEXT PRIMARY KEY,
      coin_name TEXT,
      symbol TEXT,
      last_updated TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    await run(db, `CREATE INDEX IF NOT EXISTS idx_opp_algo_time ON mining_opportunities(algo, captured_at)`);
    await run(db, `CREATE INDEX IF NOT EXISTS idx_opp_status ON mining_opportunities(profit_status, captured_at)`);
    await run(db, `CREATE INDEX IF NOT EXISTS idx_opp_coin ON mining_opportunities(coin_id, captured_at)`);
    await run(db, `CREATE INDEX IF NOT EXISTS idx_coin_prices_coin ON coin_prices(coin_id, captured_at)`);
    await run(db, `CREATE INDEX IF NOT EXISTS idx_coin_prices_time ON coin_prices(captured_at)`);

    opportunityDb = db;
    return db;
  })();
  return dbInitPromise;
}

export function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

export function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}
export let db = null;

export function setDb(dbInstance) {
  db = dbInstance;
}
