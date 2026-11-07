import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';
import { INDEX, OUT, SCAN_ROOTS } from './icons';
import { syncIconsFile } from './icons-file';

const program = syncIconsFile({
  roots: SCAN_ROOTS,
  out: OUT,
  index: INDEX,
  check: process.argv.includes('--check'),
}).pipe(Effect.provide(BunServices.layer));

if (import.meta.main) BunRuntime.runMain(program);
