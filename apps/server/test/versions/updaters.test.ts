import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveUpdater } from '../../src/versions/updaters.ts';
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

describe('resolveUpdater', () => {
  test('Claude Code always updates itself', () => {
    expect(resolveUpdater('claude', '/opt/bin/claude')).toEqual({
      command: ['/opt/bin/claude', 'update'],
      label: 'claude update',
    });
  });

  test('a Homebrew codex is upgraded with the brew beside it', () => {
    const { bin, link } = linkCodex(join(createTempDir(), 'Cellar/codex/0.153.4/bin/codex'));
    const brew = writeProgram(join(bin, 'brew'));
    expect(resolveUpdater('codex', link, NOWHERE)).toEqual({
      command: [brew, 'upgrade', 'codex'],
      label: 'brew upgrade codex',
    });
  });

  test('a bun global codex is updated with bun, found on the PATH when none sits beside it', () => {
    const { link } = linkCodex(
      join(createTempDir(), '.bun/install/global/node_modules/@openai/codex/bin/codex.js')
    );
    expect(resolveUpdater('codex', link, { which: (tool) => `/usr/local/bin/${tool}` })).toEqual({
      command: ['/usr/local/bin/bun', 'add', '-g', '@openai/codex@latest'],
      label: 'bun add -g @openai/codex@latest',
    });
  });

  test('an npm codex is updated with the npm beside it, its folder first on the PATH', () => {
    const { bin, link } = linkCodex(join(createTempDir(), 'lib/node_modules/@openai/codex/bin/codex.js'));
    const npm = writeProgram(join(bin, 'npm'));
    const updater = resolveUpdater('codex', link, NOWHERE);
    expect(updater).toMatchObject({
      command: [npm, 'install', '-g', '@openai/codex@latest'],
      label: 'npm install -g @openai/codex@latest',
    });
    expect(updater.env?.PATH?.startsWith(`${bin}:`)).toBe(true);
  });

  test('a standalone codex, or one whose package manager is gone, runs `codex update`', () => {
    const { link } = linkCodex(join(createTempDir(), '.codex/packages/standalone/current/bin/codex'));
    expect(resolveUpdater('codex', link)).toEqual({ command: [link, 'update'], label: 'codex update' });
    const npmless = linkCodex(join(createTempDir(), 'lib/node_modules/@openai/codex/bin/codex.js'));
    expect(resolveUpdater('codex', npmless.link, NOWHERE).label).toBe('codex update');
    expect(resolveUpdater('codex', '/missing/codex', NOWHERE).command).toEqual(['/missing/codex', 'update']);
  });
});
