import { resolve } from 'node:path';

const desktopDir = resolve(import.meta.dirname, '..');

const BUNDLES = [
  { entry: 'src/main/index.ts', name: 'main.cjs', target: 'node' },
  { entry: 'src/preload/index.ts', name: 'preload.cjs', target: 'browser' },
] as const;

for (const { entry, name, target } of BUNDLES) {
  const result = await Bun.build({
    entrypoints: [resolve(desktopDir, entry)],
    outdir: resolve(desktopDir, 'dist'),
    naming: name,
    target,
    format: 'cjs',
    external: ['electron'],
  });
  if (!result.success) throw new Error(`Could not bundle ${entry}:\n${result.logs.map(String).join('\n')}`);
}

process.stdout.write(`Shinsa for Mac in ${resolve(desktopDir, 'dist')}\n`);
