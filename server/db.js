import sqlite3 from 'sqlite3';
import fs from 'fs/promises';
import path from 'path';

export const DB_FILE = path.join(process.cwd(), 'database.json');
export const db = new sqlite3.Database(path.join(process.cwd(), 'mrr_monitor.db'));

export function initDatabase() {
  return new Promise((resolve, reject) => {
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
      )`, (err) => {
        if (err) console.error(`[db] Failed to create rentals table: ${err.message}`);
      });

      // Migration: Ensure existing tables have the required monitoring state columns
      db.run("ALTER TABLE rentals ADD COLUMN low_hashrate_start INTEGER DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error(`[db:migration] low_hashrate_start failed: ${err.message}`);
        }
      });
      db.run("ALTER TABLE rentals ADD COLUMN zero_hashrate_start INTEGER DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error(`[db:migration] zero_hashrate_start failed: ${err.message}`);
        }
      });

      db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )`, (err) => {
        if (err) console.error(`[db] Failed to create settings table: ${err.message}`);
      });

      db.run(`CREATE TABLE IF NOT EXISTS mrr_nonces (
        client TEXT PRIMARY KEY,
        last_nonce TEXT
      )`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

export async function cleanAllCache() {
  console.info('[init] Wiping persistent state for fresh start...');
  try {
    try {
      await fs.unlink(DB_FILE);
    } catch (e) {
      // Ignore missing cache file
    }

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run("DELETE FROM rentals", (err) => {
          if (err) console.warn(`[db] Failed to clear rentals: ${err.message}`);
        });
        db.run("DELETE FROM mrr_nonces", (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    console.info('✨ System state initialized (Cache & DB cleared).');
  } catch (err) {
    console.error(`[init] Failed to clean cache: ${err.message}`);
  }
}
