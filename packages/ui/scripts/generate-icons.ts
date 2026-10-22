/**
 * Pre-renders the Central Icons the workspace uses into
 * `src/components/icon/paths.ts`, so the bundle carries only referenced icons
 * (the logic is in `icons.ts`). Run it after using a new icon name;
 * `--check` fails instead of writing when the file is out of date.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateIcons, OUT } from './icons';

const { module, icons } = generateIcons();
const current = readFileSync(OUT, 'utf8');

if (process.argv.includes('--check')) {
  if (current !== module) {
    // biome-ignore lint/suspicious/noConsole: build script output
    console.error('[icons] paths.ts is out of date. Run: bun run --cwd packages/ui generate:icons');
    process.exit(1);
  }
  // biome-ignore lint/suspicious/noConsole: build script output
  console.log(`[icons] paths.ts is current (${icons} icons)`);
} else {
  if (current !== module) writeFileSync(OUT, module);
  // biome-ignore lint/suspicious/noConsole: build script output
  console.log(`[icons] ${icons} icons written to paths.ts`);
}
