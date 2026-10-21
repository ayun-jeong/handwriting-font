import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served from https://ayun-jeong.github.io/handwriting-font/
export default defineConfig({
  base: '/handwriting-font/',
  plugins: [react()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 16000 },
})
