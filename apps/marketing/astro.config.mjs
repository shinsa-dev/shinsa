import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import './src/lib/server-dom.ts';

const web = fileURLToPath(new URL('../web/src/', import.meta.url));
const reactSnapshots = fileURLToPath(new URL('./src/lib/react-snapshots.ts', import.meta.url));

const reactSnapshotPlugin = {
  name: 'shinsa-react-snapshots',
  enforce: 'pre',
  resolveId(id, importer) {
    if (id !== 'react' || importer === reactSnapshots) return null;
    return reactSnapshots;
  },
};

export default defineConfig({
  site: 'https://shinsa.dev',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  devToolbar: { enabled: false },
  integrations: [
    react(),
    sitemap({ filter: (page) => !(page.endsWith('/404') || page.includes('/download/')) }),
  ],
  vite: {
    plugins: [reactSnapshotPlugin, tailwindcss()],
    server: { allowedHosts: ['.ts.net'] },
    preview: { allowedHosts: ['.ts.net'] },
    resolve: {
      alias: [{ find: /^@\//, replacement: web }],
      dedupe: ['react', 'react-dom'],
    },
  },
});
