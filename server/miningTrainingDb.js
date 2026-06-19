import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'path';
import sqlite3 from 'sqlite3';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const TRAINING_DB_PATH = path.join(DATA_DIR, 'mining_training.db');

let trainingDb = null;
let initPromise = null;

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(TRAINING_DB_PATH, (err) => {
      if (err) return reject(err);
      resolve(db);
    });
  });
}

export async function initMiningTrainingDb() {
  if (trainingDb) return trainingDb;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const db = await openDb();

    await run(db, 'PRAGMA journal_mode = WAL;');
    await run(db, 'PRAGMA synchronous = NORMAL;');
    await run(db, `CREATE TABLE IF NOT EXISTS mining_training_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_hash TEXT UNIQUE,
      captured_at TEXT NOT NULL,
      nh_client TEXT,
      hero_count INTEGER DEFAULT 0,
      dutch_count INTEGER DEFAULT 0,
      mrr_count INTEGER DEFAULT 0,
      route_count INTEGER DEFAULT 0,
      opportunity_count INTEGER DEFAULT 0,
      best_algo TEXT,
      best_winner TEXT,
      best_score REAL,
      payload_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    trainingDb = db;
    return trainingDb;
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

export async function saveMiningTrainingSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;

  const db = await initMiningTrainingDb();
  const capturedAt = String(snapshot.capturedAt || snapshot.captured_at || new Date().toISOString());
  const payload = {
    ...snapshot,
    capturedAt,
  };
  const payloadJson = JSON.stringify(payload);
  const snapshotHash = crypto.createHash('sha256').update(payloadJson).digest('hex');
  const summary = snapshot.summary || {};

  await run(db, `
    INSERT OR IGNORE INTO mining_training_snapshots (
      snapshot_hash,
      captured_at,
      nh_client,
      hero_count,
      dutch_count,
      mrr_count,
      route_count,
      opportunity_count,
      best_algo,
      best_winner,
      best_score,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    snapshotHash,
    capturedAt,
    String(snapshot.nhClient || snapshot.nh_client || ''),
    Number(snapshot.heroRows?.length ?? snapshot.hero_count ?? 0),
    Number(snapshot.miningDutchRows?.length ?? snapshot.dutch_count ?? 0),
    Number(snapshot.mrrMarketRows?.length ?? snapshot.mrr_count ?? 0),
    Number(snapshot.routes?.length ?? snapshot.route_count ?? 0),
    Number(snapshot.opportunities?.length ?? snapshot.opportunity_count ?? 0),
    String(summary.bestAlgo || snapshot.bestAlgo || ''),
    String(summary.bestWinner || snapshot.bestWinner || ''),
    Number(summary.bestScore ?? snapshot.bestScore ?? 0),
    payloadJson,
  ]);

  return { snapshotHash, capturedAt };
}
