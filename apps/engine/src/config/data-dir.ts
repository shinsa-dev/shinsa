import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log/index.ts';
import { BACKUP_EXCLUSION, NEVER_INDEX_MARKER, type ServerConfig } from './schema.ts';

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
