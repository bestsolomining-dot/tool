import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig(({ command }) => ({
  plugins: [react(), command === 'build' ? cloudflare() : undefined].filter(Boolean),
  server: {
    host: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api/hm': {
        target: 'https://herominers.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/hm/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
        },
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('[Vite Proxy] /api/hm error:', err.message);
          });
        }
      },
      '/api/md': {
        target: 'https://www.mining-dutch.nl',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/md/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
        },
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('[Vite Proxy] /api/md error:', err.message);
          });
        }
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Remove ws: true if you don't need WebSockets
        // ws: true,
        timeout: 60000,
        proxyTimeout: 60000,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('[Vite Proxy] /api error:', err.message);
          });
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('[Vite Proxy] ->', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('[Vite Proxy] <-', proxyRes.statusCode, req.url);
          });
        }
      },
    },
  },
}))