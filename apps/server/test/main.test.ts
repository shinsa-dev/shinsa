import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { USAGE } from '../src/cli/index.ts';

const MAIN = join(import.meta.dirname, '../src/main.ts');

describe('the shinsa binary', () => {
  test('runs the CLI and exits with its code', async () => {
    const help = Bun.spawnSync(['bun', MAIN, 'help']);
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString().trim()).toBe(USAGE);
    const unknown = Bun.spawnSync(['bun', MAIN, 'nope']);
    expect(unknown.exitCode).toBe(1);
  });
});
