// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        ws: false,
        timeout: 30000,
        proxyTimeout: 30000,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('[Vite Proxy] Error:', err.code, err.message);
          });
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('[Vite Proxy] ->', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('[Vite Proxy] <-', proxyRes.statusCode, req.url);
          });
        }
      },
      '/api/hm': {
        target: 'https://herominers.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/hm/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      },
      '/api/md': {
        target: 'https://www.mining-dutch.nl',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/md/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    },
  },
})