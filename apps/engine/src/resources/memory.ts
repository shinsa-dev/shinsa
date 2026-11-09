import { freemem, totalmem } from 'node:os';
import { Effect, FileSystem } from 'effect';
import { describeError } from '../log/redact.ts';
import type { Argv, CommandResult } from '../shell/schema.ts';
import { ResourceReadFailed } from './monitor/schema.ts';
import { parseMemInfo, parseVmStat } from './sample.ts';
import { MEMINFO_PATH } from './schema.ts';

export const readMemoryWith = Effect.fn('ResourceMonitor.readMemory')(function* <E>(
  platform: NodeJS.Platform,
  run: (argv: Argv) => Effect.Effect<CommandResult, E>,
  readText: (path: string) => Effect.Effect<string, E>
) {
  if (platform === 'linux') return parseMemInfo(yield* readText(MEMINFO_PATH));
  if (platform === 'darwin') {
    const result = yield* run(['vm_stat']);
    return result.ok ? parseVmStat(result.stdout, totalmem()) : null;
  }
  return { usedBytes: totalmem() - freemem(), totalBytes: totalmem() };
});

export const readResourceText = Effect.fn('ResourceMonitor.readText')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .readFileString(path)
    .pipe(Effect.mapError((error) => new ResourceReadFailed({ message: describeError(error) })));
});
