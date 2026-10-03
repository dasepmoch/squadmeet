import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER = process.env.HUDDLE_SERVER_URL ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
      '/api': SERVER,
      '/config.json': SERVER,
    },
  },
  preview: { port: 4173 },
  worker: { format: 'es' },
  build: {
    target: 'es2023',
    sourcemap: true,
    chunkSizeWarningLimit: 2500,
  },
});
