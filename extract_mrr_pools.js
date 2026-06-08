import fs from 'fs/promises';
import path from 'path';

/**
 * Mini app to extract MRR rig pool configurations and match them with NiceHash pool names.
 * It reads 'mrr_rigs.csv' and 'nh_order.csv' to create 'mrr_pool.csv'.
 * Run with: node extract_mrr_pools.js
 */

async function parseCsvFile(filePath) {
  const data = await fs.readFile(filePath, 'utf-8');
  const lines = data.split('\n').filter(l => l.trim());

  if (lines.length < 2) {
    return { headers: [], rows: [] };
  }

  const parseLine = (line) => {
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

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine).map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i];
    });
    return obj;
  });

  return { headers, rows };
}

async function extractMrrPools() {
  const mrrRigsFilename = 'mrr_rigs.csv';
  const nhOrderFilename = 'nh_order.csv';
  const outputFilename = 'mrr_pool.csv';

  const mrrRigsPath = path.resolve(process.cwd(), mrrRigsFilename);
  const nhOrderPath = path.resolve(process.cwd(), nhOrderFilename);
  const outputPath = path.resolve(process.cwd(), outputFilename);

  try {
    console.log(`Reading MRR Rigs from: ${mrrRigsPath}`);
    const { rows: mrrRigs } = await parseCsvFile(mrrRigsPath);

    console.log(`Reading NiceHash Orders from: ${nhOrderPath}`);
    const { rows: nhOrders } = await parseCsvFile(nhOrderPath);

    if (mrrRigs.length === 0) {
      console.log('No MRR rig data found. Skipping mrr_pool.csv creation.');
      return;
    }

    // Build a map of NiceHash pool users to pool names
    const nhPoolUserToNameMap = new Map();
    nhOrders.forEach(order => {
      const poolUser = order.poolUser?.toLowerCase().trim();
      const poolName = order.poolName?.trim();
      if (poolUser && poolName && !nhPoolUserToNameMap.has(poolUser)) {
        nhPoolUserToNameMap.set(poolUser, poolName);
      }
    });

    const mrrPoolsWithNhNames = mrrRigs.map(rig => {
      const mrrPoolUser = rig.user?.toLowerCase().trim();
      const nhPoolName = mrrPoolUser ? nhPoolUserToNameMap.get(mrrPoolUser) : ''; // Default to empty string if no match
      return {
        id: rig.id,
        name: rig.name,
        mrrClient: rig.mrrClient,
        host: rig.host,
        port: rig.port,
        user: rig.user,
        nhPoolName: nhPoolName
      };
    });

    // Export to CSV
    if (mrrPoolsWithNhNames.length > 0) {
      const headers = Object.keys(mrrPoolsWithNhNames[0]).join(',');
      const rows = mrrPoolsWithNhNames.map(item =>
        Object.values(item).map(v => {
          const str = String(v ?? '');
          return `"${str.replace(/"/g, '""')}"`;
        }).join(',')
      ).join('\n');
      await fs.writeFile(outputPath, `${headers}\n${rows}`, 'utf-8');
      console.log(`Successfully created ${outputFilename} with ${mrrPoolsWithNhNames.length} entries.`);
    } else {
      console.log('No data to export to mrr_pool.csv.');
    }

  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Error: One or both input files (${mrrRigsFilename}, ${nhOrderFilename}) not found. Ensure the server has generated them first.`);
    } else {
      console.error(`Error processing files: ${err.message}`);
    }
  }
}

extractMrrPools();