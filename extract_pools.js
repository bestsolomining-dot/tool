import fs from 'fs/promises';
import path from 'path';

/**
 * Mini app to extract and de-duplicate pool configurations from the NiceHash orders CSV.
 * Run with: node extract_pools.js
 */
async function extractPools() {
  const inputFilename = 'nh_orders.csv';
  const outputFilename = 'pools_extracted.json';
  const filePath = path.resolve(process.cwd(), inputFilename);

  try {
    console.log(`Reading database: ${filePath}`);
    const data = await fs.readFile(filePath, 'utf-8');
    const lines = data.split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      console.log('File is empty or contains no order data.');
      return;
    }

    // Helper to parse CSV lines with quoted JSON strings (handling escaped quotes "")
    const parseCsvLine = (line) => {
      const fields = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"'; i++; // Handle escaped ""
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          fields.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      fields.push(current);
      return fields;
    };

    const headers = parseCsvLine(lines[0]);
    const poolIndex = headers.indexOf('pool');
    const clientIndex = headers.indexOf('nhClient');

    if (poolIndex === -1) {
      throw new Error('Could not find "pool" column in CSV.');
    }

    const pools = [];
    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      if (row[poolIndex]) {
        try {
          const p = JSON.parse(row[poolIndex]);
          // Map NiceHash Pool keys to Verification API keys
          p.miningAlgorithm = p.algorithm || '';
          p.stratumHost = p.stratumHostname || '';
          p.stratumPort = p.port || p.stratumPort || 0;

          // Ensure pools are associated with valid NiceHash account handles (not MRR ones)
          let nhHandle = (clientIndex !== -1 && row[clientIndex]) ? row[clientIndex] : 'BT';
          
          const u = String(p.username || '').toLowerCase();
          if (u.includes('batri')) nhHandle = 'BT';
          else if (u.includes('solomining')) nhHandle = 'PH';
          else if (u.includes('luckymining')) nhHandle = 'NHATLINH';
          else if (u.includes('lona')) nhHandle = 'KIMLOAN';

          p.client = nhHandle;
          p.nhClient = nhHandle;

          pools.push(p);
        } catch (e) {
          console.warn(`Skipping row ${i}: Invalid JSON in pool column.`);
        }
      }
    }

    // Filter for unique pools by NiceHash Pool ID
    const uniquePools = Array.from(new Map(pools.map(p => [p.id, p])).values());

    await fs.writeFile(outputFilename, JSON.stringify(uniquePools, null, 2));
    console.log(`Successfully extracted ${uniquePools.length} unique pools to ${outputFilename}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Error: ${inputFilename} not found. Ensure the server has generated the CSV first.`);
    } else {
      console.error(`Error: ${err.message}`);
    }
  }
}

extractPools();