import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
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
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
        }
      },
      '/api/md': {
        target: 'https://www.mining-dutch.nl',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/md/, ''),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
        }
      },
      '/api': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
}))
