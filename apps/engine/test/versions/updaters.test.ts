import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveUpdater } from '../../src/versions/updaters.ts';
import { runFiles } from '../harness.ts';
import { createTempDir } from '../helpers/index.ts';

function writeProgram(path: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '#!/bin/sh\n');
  chmodSync(path, 0o755);
  return path;
}

function linkCodex(target: string) {
  const bin = join(createTempDir(), 'bin');
  mkdirSync(bin);
  const link = join(bin, 'codex');
  symlinkSync(writeProgram(target), link);
  return { bin, link };
}

const NOWHERE = { which: () => null };

const updater = (...args: Parameters<typeof resolveUpdater>) => runFiles(resolveUpdater(...args));

describe('resolveUpdater', () => {
  test('Claude Code always updates itself', async () => {
    expect(await updater('claude', '/opt/bin/claude')).toEqual({
      command: ['/opt/bin/claude', 'update'],
      label: 'claude update',
    });
  });

  test('a Homebrew codex is upgraded with the brew beside it', async () => {
    const { bin, link } = linkCodex(join(createTempDir(), 'Cellar/codex/0.153.4/bin/codex'));
    const brew = writeProgram(join(bin, 'brew'));
    expect(await updater('codex', link, NOWHERE)).toEqual({
      command: [brew, 'upgrade', 'codex'],
      label: 'brew upgrade codex',
    });
  });

  test('a bun global codex is updated with bun, found on the PATH when none sits beside it', async () => {
    const { link } = linkCodex(
      join(createTempDir(), '.bun/install/global/node_modules/@openai/codex/bin/codex.js')
    );
    expect(await updater('codex', link, { which: (tool) => `/usr/local/bin/${tool}` })).toEqual({
      command: ['/usr/local/bin/bun', 'add', '-g', '@openai/codex@latest'],
      label: 'bun add -g @openai/codex@latest',
    });
  });

  test('without a bun beside a bun global codex, the bun on the PATH updates it', async () => {
    const { link } = linkCodex(
      join(createTempDir(), '.bun/install/global/node_modules/@openai/codex/bin/codex.js')
    );
    const found = await updater('codex', link);
    expect(found.command[0]).toMatch(/\/bun$/);
    expect(found.label).toBe('bun add -g @openai/codex@latest');
  });

  test('an npm codex is updated with the npm beside it, its folder first on the PATH', async () => {
    const { bin, link } = linkCodex(join(createTempDir(), 'lib/node_modules/@openai/codex/bin/codex.js'));
    const npm = writeProgram(join(bin, 'npm'));
    const found = await updater('codex', link, NOWHERE);
    expect(found).toMatchObject({
      command: [npm, 'install', '-g', '@openai/codex@latest'],
      label: 'npm install -g @openai/codex@latest',
    });
    expect(found.env?.PATH?.startsWith(`${bin}:`)).toBe(true);
  });

  test('a standalone codex, or one whose package manager is gone, runs `codex update`', async () => {
    const { link } = linkCodex(join(createTempDir(), '.codex/packages/standalone/current/bin/codex'));
    expect(await updater('codex', link)).toEqual({ command: [link, 'update'], label: 'codex update' });
    const npmless = linkCodex(join(createTempDir(), 'lib/node_modules/@openai/codex/bin/codex.js'));
    expect((await updater('codex', npmless.link, NOWHERE)).label).toBe('codex update');
    expect((await updater('codex', '/missing/codex', NOWHERE)).command).toEqual(['/missing/codex', 'update']);
  });
});
