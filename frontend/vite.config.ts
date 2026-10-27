import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Telegram Desktop on macOS uses the system Safari engine, which can be older than on phones
  build: { target: ['es2019', 'safari13', 'chrome80', 'firefox78', 'edge88'] },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
})
