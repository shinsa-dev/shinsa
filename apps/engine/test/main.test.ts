import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeHelp } from '../src/cli/help.ts';
import { createServerInstance, LOCK_FILE, resolveBootedAt, SERVICE_MARKER } from '../src/instance/index.ts';
import { createTempDir } from './helpers/index.ts';

const MAIN = join(import.meta.dirname, '../src/main.ts');

const SPAWN_TIMEOUT_MS = 20_000;

describe('the shinsa binary', () => {
  test('runs the CLI and exits with its code', async () => {
    const { COLUMNS: _columns, FORCE_COLOR: _force, ...piped } = process.env;
    const help = Bun.spawnSync(['bun', MAIN, 'help'], { env: piped });
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString().trim()).toBe(describeHelp());
    const colored = Bun.spawnSync(['bun', MAIN, 'help'], { env: { ...piped, FORCE_COLOR: '1' } });
    expect(colored.stdout.toString()).toContain('\u001b[1mUsage\u001b[22m');
    const unknown = Bun.spawnSync(['bun', MAIN, 'nope']);
    expect(unknown.exitCode).toBe(1);
  });

  test('started by launchd onto a held data folder it exits 0, so KeepAlive does not start it again', async () => {
    const home = createTempDir();
    const dataDir = join(home, 'data');
    mkdirSync(dataDir, { recursive: true });
    const holder = {
      ...createServerInstance(null, 1),
      pid: process.pid,
      port: 5180,
      url: 'http://127.0.0.1:5180',
      bootedAt: resolveBootedAt(),
    };
    writeFileSync(join(dataDir, LOCK_FILE), JSON.stringify(holder));
    const env = { ...process.env, SHINSA_HOME: home, HOME: home, SHINSA_PORT: '0' };
    const service = Bun.spawnSync(['bun', MAIN, 'engine'], {
      env: { ...env, [SERVICE_MARKER]: '1' },
      timeout: SPAWN_TIMEOUT_MS,
    });
    expect(service.exitCode).toBe(0);
    expect(`${service.stdout}${service.stderr}`).toContain(
      `"message":"[Serve] Another Shinsa holds this data directory, so the service stays stopped","dataDir":"${dataDir}","pid":${process.pid}`
    );
    const terminal = Bun.spawnSync(['bun', MAIN, 'engine'], { env, timeout: SPAWN_TIMEOUT_MS });
    expect(terminal.exitCode).toBe(1);
    expect(terminal.stderr.toString()).toContain(`Error: Shinsa is already running on ${dataDir}`);
  });
});
