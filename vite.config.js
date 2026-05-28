import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    command === 'build'
      ? cloudflare({ configPath: 'wrangler.generated.toml' })
      : undefined,
  ].filter(Boolean),
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
}))