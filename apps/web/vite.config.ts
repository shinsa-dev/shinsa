import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER = `http://127.0.0.1:${process.env.SHINSA_PORT ?? '5180'}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [{ find: /^@\//, replacement: `${resolve(import.meta.dirname, 'src')}/` }],
    dedupe: ['react', 'react-dom'],
  },
  worker: { format: 'es' },
  server: {
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER, ws: true },
    },
  },
});
