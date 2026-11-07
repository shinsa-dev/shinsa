import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { isPresent } from '../files/probe.ts';
import { Shell } from '../shell/service.ts';
import { BACKUP_EXCLUSION, NEVER_INDEX_MARKER, type ServerConfig, XATTR_TIMEOUT } from './schema.ts';

const excludeFromBackups = Effect.fn('Config.excludeFromBackups')(function* (
  dir: string,
  platform: NodeJS.Platform
) {
  const fs = yield* FileSystem.FileSystem;
  const marker = join(dir, NEVER_INDEX_MARKER);
  if (yield* isPresent(marker)) return;
  yield* fs.writeFileString(marker, '').pipe(Effect.orDie);
  if (platform !== 'darwin') return;
  const shell = yield* Shell;
  const result = yield* shell
    .run({
      argv: ['xattr', '-wx', BACKUP_EXCLUSION.name, BACKUP_EXCLUSION.value, dir],
      cwd: dir,
      timeout: XATTR_TIMEOUT,
    })
    .pipe(Effect.catchTag('CommandNotFound', () => Effect.succeed(null)));
  if (result && !result.ok) {
    yield* Effect.logWarning('[Config] Could not exclude a folder from Time Machine').pipe(
      Effect.annotateLogs({ dir, error: result.stderr.trim() })
    );
  }
});

export const prepareDataDir = Effect.fn('Config.prepareDataDir')(function* (
  config: ServerConfig,
  platform: NodeJS.Platform = process.platform
) {
  const fs = yield* FileSystem.FileSystem;
  for (const dir of [config.dataDir, config.evidenceDir, config.transcriptsDir]) {
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie);
  }
  for (const dir of [config.worktreesDir, config.checkBasesDir, config.scratchDir, config.cachesDir]) {
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie);
    yield* excludeFromBackups(dir, platform);
  }
});
