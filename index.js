import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import * as cheerio from 'cheerio';
import { createApp, initializeApp } from './server/app.js';
import { verifyToken } from './server/auth.js';
import { resolveNhClient, getNiceHashApp } from './server/nh.js';
import { mrrApiCall } from './server/mrr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, 'dist', 'client');

const app = createApp({ distPath });
const PORT = process.env.PORT || 3000;

async function scrapeHeroMinersGlobal() {
  const html = await fetch('https://herominers.com/', { headers: { 'User-Agent': 'MiningTool/2.0' } }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });

  const $ = cheerio.load(html);
  const coinStats = [];

  $('table tbody tr').each((_, row) => {
    const cols = $(row).find('td');
    if (cols.length < 9) return; 

    coinStats.push({
      algorithm: $(cols[1]).text().trim(),
      miners: parseInt($(cols[6]).text().trim().replace(/,/g, '')) || 0,
      usdPerDay: 0, 
      btcPerDay: 0,  
      coin: $(cols[0]).text().trim(),
      networkHashrate: $(cols[2]).text().trim(),
      poolHashrate: $(cols[3]).text().trim(),
      blockHeight: $(cols[4]).text().trim(),
      blocksFound: $(cols[5]).text().trim(),
      workers: $(cols[7]).text().trim(),
      totalPayments: $(cols[8]).text().trim(),
    });
  });

  return { 
    coinStats,
    miners: coinStats.reduce((acc, c) => acc + (c.miners || 0), 0)
  };
}

// GET /api/v2/mining/herominers/global – scrape HeroMiners
app.get('/api/v2/mining/herominers/global', async (req, res) => {
  try {
    const data = await scrapeHeroMinersGlobal();
    res.json({ success: true, data });
  } catch (err) {
    console.error('HeroMiners scrape error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const server = app.listen(PORT, (err) => {
  if (err) {
    console.error('[api] Failed to bind port ' + PORT + ':', err.message);
    process.exit(1);
    return;
  }

  console.log('--- NiceHash API Toolbox Server Started ---');
  console.log('Environment: ' + (process.env.NICEHASH_ENVIRONMENT ? process.env.NICEHASH_ENVIRONMENT.toUpperCase() : 'production'));
  console.log('Listening on http://localhost:' + PORT);
});

// ---------- WebSocket Server Implementation ----------
// Handles real-time stats fetching requests from miningStatsFetcher.js
const wss = new WebSocketServer({ noServer: true });

// Handle server-level WebSocket errors
wss.on('error', (err) => {
  console.error('[wss] Global WebSocket error:', err.message);
});

wss.on('connection', (ws, request) => {
  console.log(`[ws] New connection established`);
  
  ws.on('message', async (data) => {
    try {
      const payload = JSON.parse(data.toString());
      const { action, client, rigid, coin: payloadCoin } = payload;
      let responseData = {};

      // Fetch global statistics for all HeroMiners pools
      if (action === 'herominers_global' || action === 'all') {
        try {
          const scraped = await scrapeHeroMinersGlobal();
          responseData.herominers_global = { success: true, ...scraped };
        } catch (err) {
          console.error(`[ws:herominers_global] ${err.message}`);
          responseData.herominers_global = { success: false, error: err.message };
        }
      }

      if (action === 'herominers' || action === 'all') {
        try {
          // 0. Determine which HeroMiners coin subdomain to use
          let coin = payloadCoin || 'kaspa';

          // Automatically map algorithm to the correct HeroMiners subdomain
          const algoMap = {
            'randomx': 'monero', 'rx/0': 'monero', 'kawpow': 'ravencoin',
            'ironfish': 'ironfish', 'kheavyhash': 'kaspa', 'kaspa': 'kaspa',
            'autolykos': 'ergo', 'etchash': 'ethereum-classic', 'nexapow': 'nexa',
            'dynex': 'dynex', 'blake3': 'alephium'
          };

          if (!payloadCoin && rigid) {
            const isRental = String(rigid).length >= 5;
            const mrrRes = await mrrApiCall({ 
              endpoint: isRental ? `/rental/${rigid}` : `/rig/${rigid}`, 
              clientNameRaw: client 
            });
            const info = mrrRes.data?.data || mrrRes.data;
            const algo = String(info?.algo || info?.type || info?.algorithm || '').toLowerCase().trim();

            for (const [key, value] of Object.entries(algoMap)) {
              if (algo.includes(key)) {
                coin = value;
                break;
              }
            }
          }

          // 1. Resolve the address for the requested client (defaults to NiceHash address)
          const { client: nhClientInstance } = resolveNhClient(client);
          const nhApp = getNiceHashApp(nhClientInstance);
          const addrData = await nhApp.mining.getMiningAddress();
          const address = addrData.miningAddress;

          // 2. Fetch from HeroMiners
          const url = `https://${coin}.herominers.com/api/stats/${address}`;
          console.log(`[ws:herominers] Fetching ${coin} stats for ${address}...`);
          const hmRes = await fetch(url, { headers: { 'User-Agent': 'MiningTool/2.0' } });
          
          if (hmRes.ok) {
            const stats = await hmRes.json();
            responseData.herominers = { success: true, ...stats };
          } else if (hmRes.status === 404) {
            responseData.herominers = { success: false, error: `Address not found on HeroMiners ${coin} pool. Make sure the rig is actively mining to this pool.` };
          } else {
            throw new Error(`HeroMiners returned ${hmRes.status}`);
          }
        } catch (err) {
          console.error(`[ws:herominers] ${err.message}`);
          responseData.herominers = { success: false, error: err.message };
        }
      }

      if (action === 'miningpooldutch' || action === 'all') {
        try {
          const url = 'https://www.mining-dutch.nl/api.php?info=stats';
          const mdRes = await fetch(url, { headers: { 'User-Agent': 'MiningTool/2.0' } });
          if (mdRes.ok) {
            const rawData = await mdRes.json();
            // Transform Mining-Dutch nested dictionary into a list of algorithms
            const algoStats = Object.entries(rawData || {}).map(([name, d]) => ({
              algo: name,
              hashrate: d.hashrate || '0 H/s',
              miners: d.miners || 0,
              workers: d.workers || 0,
              difficulty: d.difficulty || '0'
            }));
            responseData.miningpooldutch = { success: true, algoStats, totalAlgos: algoStats.length };
          }
        } catch (err) {
          console.error(`[ws:miningdutch] ${err.message}`);
          responseData.miningpooldutch = { success: false, error: err.message };
        }
      }

      // Determine overall success. If "all", we succeed if at least one part exists.
      // If specific action, we succeed only if that specific action succeeded.
      const isSuccess = action === 'all'
        ? (Object.keys(responseData).length > 0) 
        : (responseData[action] && responseData[action].success !== false &&
           (responseData[action].coinStats?.length > 0 || responseData[action].stats || responseData[action].algoStats?.length > 0));
      
      const errorMsg = !isSuccess ? (responseData[action]?.error || `No data found for "${action}". Check if mining is active or API is reachable.`) : null;

      // IMPORTANT: We always send the full responseData object.
      // This ensures the frontend always finds data.herominers or data.miningpooldutch
      // regardless of whether one or all were requested, keeping the data shape consistent.
      ws.send(JSON.stringify({
        success: isSuccess,
        error: errorMsg,
        action,
        client,
        data: responseData
      }));
    } catch (err) {
      console.error('[ws:message] Error:', err.message);
      ws.send(JSON.stringify({ success: false, error: 'Internal server error: ' + err.message }));
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = url.pathname.replace(/\/$/, ''); // Remove trailing slash

    if (pathname === '/api/v2/mrr/fetch/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      // Only destroy if it's explicitly an API path we don't recognize.
      // If it's a root path, it might be Vite's HMR, so we let it be.
      if (pathname.startsWith('/api')) {
        socket.destroy();
      }
    }
  } catch (err) {
    console.error('[ws:upgrade] Error during upgrade:', err.message);
    socket.destroy();
  }
});

server.on('error', (err) => {
  console.error('[api] Server error on port ' + PORT + ':' , err.message);
});

function shutdown(signal) {
  console.log('[api] Received ' + signal + ', shutting down...');
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (process.env.RUN_MAIN !== 'false') {
  initializeApp(process.env).catch((err) => {
    console.error('[init] Failed during startup:', err.message);
  });
}
