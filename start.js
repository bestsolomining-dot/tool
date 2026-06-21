// start.js
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

console.log('🚀 Starting NiceHash Tool...');

// Start backend
const backend = spawn('npm', ['run', 'backend'], { stdio: 'pipe', shell: true });

backend.stdout.on('data', (data) => {
  const output = data.toString();
  console.log('[Backend]', output.trim());
  
  if (output.includes('Listening on http://localhost:3000')) {
    console.log('✅ Backend ready!');
    // Start frontend after a short delay
    setTimeout(async () => {
      console.log('🚀 Starting frontend...');
      const frontend = spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true });
    }, 1000);
  }
});

backend.stderr.on('data', (data) => {
  console.error('[Backend Error]', data.toString().trim());
});

console.log('📡 Use Ctrl+C to stop all processes');