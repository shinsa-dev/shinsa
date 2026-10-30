import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER = `http://127.0.0.1:${process.env.SHINSA_PORT ?? '5180'}`;

const REMOTE = process.env.VITE_SHINSA_REMOTE === '1';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  ...(REMOTE
    ? {
        base: '/',
        build: {
          outDir: 'dist-remote',
          rollupOptions: {
            input: {
              main: resolve(import.meta.dirname, 'index.html'),
              sw: resolve(import.meta.dirname, 'src/remote-sw.ts'),
            },
            output: {
              entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
            },
          },
        },
      }
    : {}),
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
