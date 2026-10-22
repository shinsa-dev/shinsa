import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repo } from '@shinsa/core';
import { resolveCheckCommands, runCheck, runChecks, tailOutput } from '../../src/checks/index.ts';

const dirs: string[] = [];

function createDir() {
  const dir = mkdtempSync(join(tmpdir(), 'shinsa-checks-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repoAt(path: string, checkCommands: string[] = []): Repo {
  return {
    id: 'r',
    areaId: null,
    name: 'r',
    path,
    defaultBranch: 'main',
    remote: null,
    checkCommands,
    previewCommand: null,
  };
}

describe('checks', () => {
  test('configured commands win over package scripts', () => {
    const dir = createDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { lint: 'x' } }));
    expect(resolveCheckCommands(repoAt(dir, ['make check']), dir)).toEqual(['make check']);
  });

  test('without configured commands, package scripts are used with the right runner', () => {
    const dir = createDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'x', lint: 'x', dev: 'x' } }));
    writeFileSync(join(dir, 'bun.lock'), '');
    expect(resolveCheckCommands(repoAt(dir), dir)).toEqual(['bun run lint', 'bun run test']);
  });

  test('a failing command keeps the tail of its output', async () => {
    const dir = createDir();
    const result = await runCheck("echo 'src/a.ts(3,1): error TS2322' >&2; exit 2", dir);
    expect(result).toEqual({
      name: "echo 'src/a.ts(3,1): error TS2322' >&2; exit 2",
      outcome: 'fail',
      detail: 'src/a.ts(3,1): error TS2322',
    });
    expect(await runCheck('true', dir)).toEqual({ name: 'true', outcome: 'pass', detail: null });
  });

  test('every command runs even after one fails', async () => {
    const dir = createDir();
    const results = await runChecks(repoAt(dir, ['false', 'true']), dir);
    expect(results.map((check) => check.outcome)).toEqual(['fail', 'pass']);
  });

  test('long output is cut to its end', () => {
    const text = `${'a'.repeat(5000)}END`;
    expect(tailOutput(text).endsWith('END')).toBe(true);
    expect(tailOutput(text).length).toBeLessThan(4100);
  });
});

describe('long check output', () => {
  test('keeps the failing lines even when they are far from the end', () => {
    const text = [
      '(fail) parser > reads merged state',
      'expected merged, received open',
      ...Array.from({ length: 400 }, (_, index) => `noise line ${index} ${'x'.repeat(20)}`),
    ].join('\n');
    const output = tailOutput(text);
    expect(output).toContain('(fail) parser > reads merged state');
    expect(output).toContain('expected merged, received open');
    expect(output.endsWith('noise line 399 xxxxxxxxxxxxxxxxxxxx')).toBe(true);
  });
});

describe('runners and failures', () => {
  test('pnpm, yarn and npm repositories run their own scripts; no manifest means no checks', () => {
    for (const [lockfile, runner] of [
      ['pnpm-lock.yaml', 'pnpm run'],
      ['yarn.lock', 'yarn'],
      ['package-lock.json', 'npm run'],
    ]) {
      const dir = createDir();
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { typecheck: 'x' } }));
      writeFileSync(join(dir, lockfile ?? ''), '');
      expect(resolveCheckCommands(repoAt(dir), dir)).toEqual([`${runner} typecheck`]);
    }
    const bare = createDir();
    writeFileSync(join(bare, 'package.json'), '{}');
    expect(resolveCheckCommands(repoAt(bare), bare)).toEqual([]);
    expect(resolveCheckCommands(repoAt(createDir()), createDir())).toEqual([]);
  });

  test('a manifest that is not JSON is reported, not crashed on', () => {
    const dir = createDir();
    writeFileSync(join(dir, 'package.json'), '{ nope');
    expect(() => resolveCheckCommands(repoAt(dir), dir)).toThrow('is not valid JSON');
  });

  test('a check that runs too long is stopped and says so; a silent failure gives its exit code', async () => {
    const dir = createDir();
    const slow = await runCheck('echo started; sleep 30', dir, 100);
    expect(slow.outcome).toBe('fail');
    expect(slow.detail).toBe('Stopped after 0 minutes.\nstarted');
    expect((await runCheck('exit 7', dir)).detail).toBe('exit 7');
  });

  test('short output is kept whole and output without a signal keeps its end', () => {
    expect(tailOutput('  short  ')).toBe('short');
    expect(tailOutput('x'.repeat(5000)).startsWith('…\n')).toBe(true);
  });
});
