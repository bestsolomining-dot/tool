// start.js
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Starting NiceHash Tool...');
console.log('📁 Working directory:', __dirname);

// Function to kill all processes on exit
let processes = [];

function cleanup() {
  console.log('\n🛑 Shutting down...');
  processes.forEach(p => {
    try {
      p.kill();
    } catch (e) {
      // ignore
    }
  });
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start backend
console.log('📡 Starting backend server...');
const backend = spawn('node', ['index.js'], {
  stdio: 'pipe',
  shell: true,  // Use shell: true for Windows compatibility
  env: { ...process.env }
});

processes.push(backend);

let backendReady = false;

backend.stdout.on('data', (data) => {
  const output = data.toString().trim();
  if (output) console.log('[Backend]', output);
  
  // Check if backend is ready
  if (output.includes('Listening on http://localhost:3000')) {
    backendReady = true;
    console.log('✅ Backend ready! Starting frontend...');
    
    // Start frontend after a short delay
    setTimeout(() => {
      console.log('🎨 Starting frontend...');
      
      // Use 'npm.cmd' on Windows, 'npm' on Unix
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      
      const frontend = spawn(npmCmd, ['run', 'dev'], {
        stdio: 'inherit',
        shell: true,  // Use shell: true for Windows
        env: { ...process.env }
      });
      processes.push(frontend);
      
      frontend.on('error', (err) => {
        console.error('❌ Frontend error:', err.message);
      });
      
      frontend.on('close', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`❌ Frontend exited with code ${code}`);
        }
      });
    }, 1500);
  }
});

backend.stderr.on('data', (data) => {
  const error = data.toString().trim();
  // Don't log ECONNREFUSED errors (they're expected during startup)
  if (error && !error.includes('ECONNREFUSED') && !error.includes('DeprecationWarning')) {
    console.error('[Backend Error]', error);
  }
});

backend.on('error', (err) => {
  console.error('❌ Backend error:', err.message);
});

backend.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`❌ Backend exited with code ${code}`);
  }
  if (!backendReady) {
    console.log('❌ Backend failed to start. Please check the errors above.');
  }
});

console.log('📡 Backend starting... Waiting for ready signal.');
console.log('💡 Press Ctrl+C to stop all services.');