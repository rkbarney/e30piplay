/* eslint-env node */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Mirror the Pi's nginx: /api/* → carplay-server (default port 3001), so
      // dev fetches stay same-origin. Override the target with S52_API_PROXY
      // when the server runs elsewhere. Harmless when no server is running.
      '/api': process.env.S52_API_PROXY || 'http://127.0.0.1:3001',
    },
  },
})
