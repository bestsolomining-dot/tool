import sqlite3 from 'sqlite3';
import fs from 'fs/promises';
import path from 'path';

export const DB_FILE = path.join(process.cwd(), 'database.json');
export const db = new sqlite3.Database(path.join(process.cwd(), 'mrr_monitor.db'));

export function initDatabase() {
  return new Promise((resolve) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS rentals (
        id TEXT PRIMARY KEY,
        name TEXT,
        client TEXT,
        algo TEXT,
        target_100 REAL,
        last_notified INTEGER DEFAULT 0,
        last_updated INTEGER,
        low_hashrate_start INTEGER DEFAULT 0,
        zero_hashrate_start INTEGER DEFAULT 0
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS mrr_nonces (
        client TEXT PRIMARY KEY,
        last_nonce TEXT
      )`);
      resolve();
    });
  });
}

export async function cleanAllCache() {
  console.info('[init] Cleaning all cached data (SQLite rentals & database.json)...');
  try {
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM rentals`, (err) => err ? reject(err) : resolve());
    });

    try {
      await fs.unlink(DB_FILE);
    } catch (e) {
      // Ignore missing cache file
    }

    console.info('✨ Cache cleared successfully.');
  } catch (err) {
    console.error(`[init] Failed to clean cache: ${err.message}`);
  }
}
