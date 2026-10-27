import { resolve } from 'node:path';
import { parseAppFlavor } from '@shinsa/core';

const desktopDir = resolve(import.meta.dirname, '..');

const flavor = parseAppFlavor(Bun.env.SHINSA_FLAVOR || 'stable');
if (!flavor) throw new Error(`SHINSA_FLAVOR must be stable or canary, not "${Bun.env.SHINSA_FLAVOR}".`);

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
    define: { 'process.env.SHINSA_BUILD_FLAVOR': JSON.stringify(flavor) },
  });
  if (!result.success) throw new Error(`Could not bundle ${entry}:\n${result.logs.map(String).join('\n')}`);
}

process.stdout.write(`Shinsa for Mac (${flavor}) in ${resolve(desktopDir, 'dist')}\n`);
