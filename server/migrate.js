import path from 'path';
import fs from 'node:fs/promises';
import fg from 'fast-glob';
import XLSX from 'xlsx';
import { db } from './db.js';

const PROJECT_ROOT = process.cwd();
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

/**
 * One-time migration utility to import old CSV files from the root directory
 * into the new SQLite database.
 */
export async function migrateOldCsvToDb() {
  console.log('[migrate] Checking for old CSV files to import...');
  // Search for CSVs in the project root, ignoring the data directory
  const csvFiles = await fg('*.csv', { cwd: PROJECT_ROOT, absolute: true, ignore: ['data/**'] });

  if (csvFiles.length === 0) {
    console.log('[migrate] No old CSV files found in the root directory.');
    return;
  }

  console.log(`[migrate] Found ${csvFiles.length} CSV files to migrate.`);
  const migratedDir = path.join(DATA_DIR, 'migrated_csv');
  await fs.mkdir(migratedDir, { recursive: true });

  for (const filePath of csvFiles) {
    const filename = path.basename(filePath);
    const tableName = filename.replace('.csv', '').replace(/-/g, '_');
    
    try {
      console.log(`[migrate] Processing ${filename}...`);
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      // Use `defval: ''` to ensure all cells are represented, even if empty.
      // This prevents errors from rows with fewer columns than the header.
      // `raw: false` ensures values are parsed as strings, which is safer for this import.
      const items = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false, defval: '' });

      if (!items || items.length === 0) {
        console.warn(`[migrate] ${filename} is empty or could not be parsed. Skipping.`);
        continue;
      }

      // Define a master list of columns to handle schema evolution.
      // This prevents errors if old CSVs have fewer columns than new ones.
      let columns = Object.keys(items[0]);
      const masterNhOrderColumns = [
        'id', 'acceptedCurrentSpeed', 'algorithmSpeed', 'niceAdvertisedHashrate',
        'poolName', 'poolHost', 'poolPort', 'algorithm', 'market', 'price',
        'limit', 'payedAmount', 'availableAmount', 'rigsCount', 'poolUser',
        'poolPass', 'status', 'isDead', 'pool', 'nhClient', 'ts'
      ];

      if (tableName === 'nh_order') {
        // Use a Set for efficient union of master columns and columns from the file
        columns = Array.from(new Set([...masterNhOrderColumns, ...columns]));
      }

      const columnDefs = columns.map(c => `"${c}" TEXT`).join(', ');

      await new Promise((resolve, reject) => {
        db.serialize(() => {
          db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefs})`, (err) => {
            if (err) return reject(new Error(`Failed to create table ${tableName}: ${err.message}`));

            const placeholders = columns.map(() => '?').join(', ');
            const stmt = db.prepare(`INSERT OR IGNORE INTO ${tableName} (${columns.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`);

            items.forEach(item => {
              // Use the master list for `nh_order` to ensure all columns are accounted for,
              // otherwise use the columns derived from the file itself.
              const columnsToInsert = tableName === 'nh_order' ? masterNhOrderColumns : columns;
              const values = columnsToInsert.map(c => {
                const v = item[c]; // Ensure a value for every column, even if undefined in the source
                return typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
              });
              stmt.run(...values);
            });
            stmt.finalize(resolve);
          });
        });
      });

      console.log(`[migrate] Successfully imported ${items.length} rows into table "${tableName}".`);
      await fs.rename(filePath, path.join(migratedDir, filename));
      console.log(`[migrate] Moved ${filename} to migrated_csv directory.`);
    } catch (err) {
      console.error(`[migrate] Failed to process ${filename}: ${err.message}`);
    }
  }
  console.log('[migrate] CSV migration complete.');
}