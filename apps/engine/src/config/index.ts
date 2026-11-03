import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigProvider, Effect } from 'effect';
import { BUNDLE, type ShinsaBundle } from '../instance/bundle.ts';
import { log } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { MachineConfigFile } from './machine/service.ts';
import { resolveShinsaPaths } from './paths.ts';
import { createConfigProvider } from './provider.ts';
import { BACKUP_EXCLUSION, type Env, NEVER_INDEX_MARKER, type ServerConfig } from './schema.ts';
import { EngineConfig } from './service.ts';
import { readServerAddress } from './settings.ts';

export { ConfigStore } from './file.ts';
export { resolveScratchPath, resolveShinsaPaths } from './paths.ts';
export type { Env, ServerConfig } from './schema.ts';

export function resolveServerAddress(env: Env) {
  return edgeRuntime.runSync(
    Effect.gen(function* () {
      const machine = yield* (yield* MachineConfigFile).read(resolveShinsaPaths(env).configPath);
      return yield* readServerAddress().pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, createConfigProvider(env, machine.config))
      );
    })
  );
}

export function resolveConfig(env: Env, bundle: ShinsaBundle | null = BUNDLE): ServerConfig {
  return edgeRuntime.runSync(Effect.provide(EngineConfig, EngineConfig.layer(env, bundle)));
}

function excludeFromBackups(dir: string, platform: NodeJS.Platform) {
  const marker = join(dir, NEVER_INDEX_MARKER);
  if (existsSync(marker)) return;
  writeFileSync(marker, '');
  const xattr = platform === 'darwin' ? Bun.which('xattr', { PATH: process.env.PATH ?? '' }) : null;
  if (!xattr) return;
  const result = Bun.spawnSync([xattr, '-wx', BACKUP_EXCLUSION.name, BACKUP_EXCLUSION.value, dir], {
    stdout: 'ignore',
    stderr: 'pipe',
  });
  if (!result.success) {
    log.warn('[Config] Could not exclude a folder from Time Machine', {
      dir,
      error: result.stderr.toString().trim(),
    });
  }
}

export function prepareDataDir(config: ServerConfig, platform = process.platform) {
  for (const dir of [config.dataDir, config.evidenceDir, config.transcriptsDir]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const dir of [config.worktreesDir, config.checkBasesDir, config.scratchDir, config.cachesDir]) {
    mkdirSync(dir, { recursive: true });
    excludeFromBackups(dir, platform);
  }
}
