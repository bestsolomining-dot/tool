import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp, initializeApp } from './server/app.js';

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
  initializeApp().catch((err) => {
    console.error('[init] Failed during startup:', err.message);
  });
}
