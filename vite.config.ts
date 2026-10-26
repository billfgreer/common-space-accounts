import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/common-space-accounts/',
  server: {
    port: 5176,
  },
  // maplibre-gl spins up its worker via `new Worker(new URL(..., import.meta.url))`.
  // Vite's dep pre-bundling rewrites that import.meta.url to point at the
  // .vite/deps cache, which breaks the worker's relative path — excluding it
  // from pre-bundling keeps it served straight from node_modules instead.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
