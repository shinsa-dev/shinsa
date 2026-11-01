import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BaseCheckouts, type BaseRequest } from '../../src/checks/base.ts';
import { type CheckFailure, listCheckFailures } from '../../src/checks/failures.ts';
import type { CheckRun } from '../../src/checks/index.ts';
import { log } from '../../src/log/index.ts';
import { createGitRepo, createTempDir, git, writeFiles } from '../helpers/index.ts';

const BROKEN_TEST = `import { expect, test } from 'bun:test';
test('is broken', () => {
  expect(1).toBe(2);
});
`;

const TYPE_ERROR = 'src/a.ts(3,1): error TS2322: Type string is not assignable.';

function failuresOf(output: string, root = '/repo') {
  return listCheckFailures(output, root);
}

function runOf(
  command: string,
  failedFiles: string[] | null = null,
  failures: CheckFailure[] | null = failuresOf(TYPE_ERROR)
): CheckRun {
  return {
    check: { id: 'c1', label: 'Tests', command, outcome: 'fail', detail: null },
    output: '',
    timedOut: false,
    failedFiles,
    failures,
  };
}

function failing(script = 'true') {
  return `${script}; echo '${TYPE_ERROR}'; exit 1`;
}

function countOf(diff: { added: unknown[]; known: unknown[] } | null) {
  return diff ? { added: diff.added.length, known: diff.known.length } : null;
}

async function commitAll(path: string, message: string) {
  await git(path, 'add', '-A');
  await git(path, 'commit', '-q', '-m', message);
  return (await git(path, 'rev-parse', 'HEAD')).trim();
}

async function createBase(files: Record<string, string>) {
  const { path, repo } = await createGitRepo({ remote: false, files: { 'package.json': '{}', ...files } });
  const base = (await git(path, 'rev-parse', 'HEAD')).trim();
  return { path, repo, base };
}

function requestOf(
  setup: Awaited<ReturnType<typeof createBase>>,
  run: CheckRun,
  base = setup.base
): BaseRequest {
  return {
    repo: setup.repo,
    resolveBase: () => Promise.resolve(base),
    cwd: setup.path,
    run,
    timeoutMs: 60_000,
  };
}

function countingCommand(file: string, script: string) {
  return `echo run >> ${file}; ${script}`;
}

function readCount(file: string) {
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').length : 0;
}

describe('running a failing check on the base commit', () => {
  test('a command that fails on the base too is compared error by error, run once per base and command', async () => {
    const setup = await createBase({ 'flag.txt': 'old' });
    const counter = join(createTempDir(), 'runs.log');
    const bases = new BaseCheckouts(join(createTempDir(), 'bases'));
    const broken = runOf(countingCommand(counter, failing()));
    expect(countOf(await bases.compareWithBase(requestOf(setup, broken)))).toEqual({ added: 0, known: 1 });
    expect(countOf(await bases.compareWithBase(requestOf(setup, broken)))).toEqual({ added: 0, known: 1 });
    expect(readCount(counter)).toBe(1);
    const passing = runOf(countingCommand(counter, 'test -f flag.txt'));
    expect(await bases.compareWithBase(requestOf(setup, passing))).toBeNull();
  });

  test('a test file or a path the change added is never blamed on the base', async () => {
    const setup = await createBase({ 'test/old.test.ts': '' });
    writeFiles(setup.path, { 'test/new.test.ts': '', 'src/new/x.ts': '' });
    await commitAll(setup.path, 'feat: add');
    const bases = new BaseCheckouts(join(createTempDir(), 'bases'));
    const added = runOf(failing(), ['test/new.test.ts']);
    expect(await bases.compareWithBase(requestOf(setup, added))).toBeNull();
    expect(
      await bases.compareWithBase(requestOf(setup, runOf(failing('true src/new --cwd=src/new'))))
    ).toBeNull();
    const old = runOf(failing("true './test/old.test.ts' -x"));
    expect(countOf(await bases.compareWithBase(requestOf(setup, old)))).toEqual({ added: 0, known: 1 });
  });

  test('failing tests are compared by name, so a new test failing in a file that fails on the base is new', async () => {
    const setup = await createBase({ 'a.test.ts': BROKEN_TEST });
    const bases = new BaseCheckouts(join(createTempDir(), 'bases'));
    const command = 'bun test ./a.test.ts';
    const output = (tests: string[]) =>
      [
        'bun test v1.4.4',
        'a.test.ts:',
        ...tests.map((name) => `(fail) ${name}`),
        ` ${tests.length} fail`,
      ].join('\n');
    const same = runOf(command, ['a.test.ts'], failuresOf(output(['is broken']), setup.path));
    expect(countOf(await bases.compareWithBase(requestOf(setup, same)))).toEqual({ added: 0, known: 1 });
    const more = runOf(
      command,
      ['a.test.ts'],
      failuresOf(output(['is broken', 'is new [2.00ms]']), setup.path)
    );
    const diff = await bases.compareWithBase(requestOf(setup, more));
    expect(diff?.added.map((failure) => failure.label)).toEqual(['a.test.ts › is new']);
    expect(diff?.known.map((failure) => failure.label)).toEqual(['a.test.ts › is broken']);
  });

  test('a failure Shinsa cannot read, now or on the base, is never compared', async () => {
    const setup = await createBase({});
    const counter = join(createTempDir(), 'runs.log');
    const bases = new BaseCheckouts(join(createTempDir(), 'bases'));
    const unread = runOf(countingCommand(counter, 'exit 1'), null, null);
    expect(await bases.compareWithBase(requestOf(setup, unread))).toBeNull();
    expect(readCount(counter)).toBe(0);
    expect(await bases.compareWithBase(requestOf(setup, runOf('echo something broke; exit 1')))).toBeNull();
  });

  test('no base commit, a value that is not one, or a base git cannot check out is no comparison', async () => {
    const setup = await createBase({});
    const bases = new BaseCheckouts(join(createTempDir(), 'bases'));
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      const command = failing();
      expect(await bases.compareWithBase(requestOf(setup, runOf(command), ''))).toBeNull();
      expect(await bases.compareWithBase(requestOf(setup, runOf(command), '--help'))).toBeNull();
      expect(await bases.compareWithBase(requestOf(setup, runOf(command), 'f'.repeat(40)))).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[Checks] Could not run a check on the base commit',
        expect.objectContaining({ repoId: 'repo-1', command })
      );
      const broken = {
        ...requestOf(setup, runOf(command)),
        resolveBase: () => Promise.reject(new Error('gone')),
      };
      expect(await bases.compareWithBase(broken)).toBeNull();
      expect(countOf(await bases.compareWithBase(requestOf(setup, runOf(command))))).toEqual({
        added: 0,
        known: 1,
      });
    } finally {
      warn.mockRestore();
    }
  });

  test('a cancelled or stopped run is not kept, so the next asks again', async () => {
    const setup = await createBase({});
    const counter = join(createTempDir(), 'runs.log');
    const bases = new BaseCheckouts(join(createTempDir(), 'bases'));
    const slow = runOf(countingCommand(counter, 'sleep 30'));
    expect(await bases.compareWithBase({ ...requestOf(setup, slow), timeoutMs: 100 })).toBeNull();
    const controller = new AbortController();
    const cancelled = bases.compareWithBase({ ...requestOf(setup, slow), signal: controller.signal });
    setTimeout(() => controller.abort(), 200);
    expect(await cancelled).toBeNull();
    expect(readCount(counter)).toBe(2);
  });

  test('only the most recent checkouts are kept, and folders left from before are removed, but not the folder’s own markers', async () => {
    const setup = await createBase({ 'v.txt': '1' });
    const first = setup.base;
    writeFileSync(join(setup.path, 'v.txt'), '2');
    const second = await commitAll(setup.path, 'chore: two');
    const dir = join(createTempDir(), 'bases');
    mkdirSync(join(dir, 'left-over'), { recursive: true });
    writeFileSync(join(dir, '.metadata_never_index'), '');
    const bases = new BaseCheckouts(dir, 1);
    const one = runOf(failing('grep -q 1 v.txt || exit 0'));
    const two = runOf(failing('grep -q 2 v.txt || exit 0'));
    expect(await bases.compareWithBase(requestOf(setup, one, first))).not.toBeNull();
    expect(existsSync(join(dir, 'left-over'))).toBe(false);
    expect(existsSync(join(dir, '.metadata_never_index'))).toBe(true);
    expect(await bases.compareWithBase(requestOf(setup, two, second))).not.toBeNull();
    expect(existsSync(join(dir, `repo-1-${first.slice(0, 12)}`))).toBe(false);
    expect(existsSync(join(dir, `repo-1-${second.slice(0, 12)}`))).toBe(true);
    expect(await bases.compareWithBase(requestOf(setup, one, first))).not.toBeNull();
  });
});
