import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { createApp, initializeApp } from './server/app.js';
import { verifyToken } from './server/auth.js';
import { resolveNhClient, getNiceHashApp } from './server/nh.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, 'dist', 'client');

const app = createApp({ distPath });
const PORT = process.env.PORT || 3000;
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

wss.on('connection', (ws, request) => {
  console.log(`[ws] New connection established`);
  
  ws.on('message', async (data) => {
    try {
      const { action, client, rigid } = JSON.parse(data.toString());
      let responseData = {};

      if (action === 'herominers' || action === 'all') {
        try {
          // 1. Resolve the address for the requested client (defaults to NiceHash address)
          const { client: nhClientInstance } = resolveNhClient(client);
          const nhApp = getNiceHashApp(nhClientInstance);
          const addrData = await nhApp.mining.getMiningAddress();
          const address = addrData.miningAddress;

          // 2. Fetch from HeroMiners (Example using 'kaspa', change as needed)
          const coin = 'kaspa'; 
          const url = `https://${coin}.herominers.com/api/stats/${address}`;
          const hmRes = await fetch(url, { headers: { 'User-Agent': 'MiningTool/2.0' } });
          
          if (hmRes.ok) {
            responseData.herominers = await hmRes.json();
          } else {
            throw new Error(`HeroMiners returned ${hmRes.status}`);
          }
        } catch (err) {
          console.error(`[ws:herominers] Fetch failed: ${err.message}`);
          responseData.herominers = { success: false, error: err.message };
        }
      }

      if (action === 'miningpooldutch' || action === 'all') {
        responseData.miningpooldutch = {
          stats: { hashrate: 0 },
          workers: []
        };
      }

      ws.send(JSON.stringify({
        success: true,
        action,
        client,
        data: responseData
      }));
    } catch (err) {
      ws.send(JSON.stringify({ success: false, error: 'Invalid request format' }));
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === '/api/v2/mrr/fetch/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    // Let other upgrades fall through or destroy
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
