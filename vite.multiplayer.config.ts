import { defineConfig } from 'vite';
export default defineConfig({
  root: 'client',
  publicDir: '../public',
  build: {
    outDir: '../dist/multiplayer',
    emptyOutDir: true,
    rollupOptions: { input: 'client/multiplayer.html' },
  },
  server: {
    proxy: {
      '/socket.io': { target: 'http://127.0.0.1:3001', ws: true },
      '/health': 'http://127.0.0.1:3001',
    },
  },
});
