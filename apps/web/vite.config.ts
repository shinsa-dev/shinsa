import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const DAEMON = `http://127.0.0.1:${process.env.SHINSA_PORT ?? '5180'}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${resolve(import.meta.dirname, 'src')}/` },
      { find: /^@shinsa\/ui\//, replacement: `${resolve(import.meta.dirname, '../../packages/ui/src')}/` },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: {
    proxy: {
      '/api': DAEMON,
      '/ws': { target: DAEMON, ws: true },
    },
  },
});
