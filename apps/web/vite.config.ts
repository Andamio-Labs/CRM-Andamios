import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// La web habla con la API por el MISMO origen (/api → proxy): sin CORS y con cookies de sesión simples.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // ws: true → también pasa el WebSocket del Kanban en tiempo real (/api/socket.io).
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', ws: true } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
