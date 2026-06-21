import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig(({ command }) => ({
  plugins: [react(), command === 'build' ? cloudflare() : undefined].filter(Boolean),
  server: {
    host: true,
    watch: { usePolling: true },
    proxy: {
      '/api/hm': {
        target: 'https://herominers.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/hm/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0' }
      },
      '/api/md': {
        target: 'https://www.mining-dutch.nl',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/md/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0' }
      },
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        timeout: 30000,
        proxyTimeout: 30000,
      },
    },
  },
}))