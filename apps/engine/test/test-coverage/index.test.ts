import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CoverageSetting, Repo, Task } from '@shinsa/core';
import { createWorktree } from '../../src/git/index.ts';
import { measureTaskCoverage } from '../../src/test-coverage/index.ts';
import { LedgerStore } from '../../src/workspaces/ledger.ts';
import { createGitRepo, createTempDir, git, until, writeFiles } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

const SOURCE = ['export function add(a, b) {', '  return a + b;', '}', ''].join('\n');

const CHANGED = [
  'export function add(a, b) {',
  '  if (a < 0) throw new Error("negative");',
  '  return a + b;',
  '}',
  'export function sub(a, b) {',
  '  return a - b;',
  '}',
  '',
].join('\n');

const LCOV = [
  'SF:$PWD/src/math.js',
  'DA:1,4',
  'DA:2,4',
  'DA:3,4',
  'DA:5,0',
  'DA:6,0',
  'end_of_record',
  'SF:src/fresh.js',
  'DA:1,1',
  'end_of_record',
].join('\\n');

function writeReport(text: string) {
  return `mkdir -p coverage && printf '${text}\\n' | sed "s#\\$PWD#$PWD#" > coverage/lcov.info`;
}

async function createChangedWorktree() {
  const { repo } = await createGitRepo({ files: { 'src/math.js': SOURCE } });
  const worktree = await createWorktree(repo, createTempDir(), 'task-1', 'feat/sub', null);
  writeFiles(worktree.path, { 'src/math.js': CHANGED });
  await git(worktree.path, 'commit', '-qam', 'feat: sub');
  writeFiles(worktree.path, { 'src/fresh.js': 'export const fresh = 1;\n' });
  return { repo, worktree: worktree.path };
}

function custom(command: string, report = 'coverage/lcov.info'): CoverageSetting {
  return { mode: 'custom', command, report, format: null };
}

function measure(
  repo: Repo,
  task: Partial<Task>,
  coverage: CoverageSetting,
  signal = new AbortController().signal,
  ledgers = new LedgerStore(createTempDir())
) {
  return measureTaskCoverage({
    repo: { ...repo, coverage },
    task: createTask({ branch: 'feat/sub', ...task }),
    ledgers,
    baseBranch: null,
    signal,
    timeoutMs: 5_000,
  });
}

describe('measuring the changed lines', () => {
  test('counts the changed lines the report marks executable, per file, with the missed ones as ranges', async () => {
    const { repo, worktree } = await createChangedWorktree();
    const command = writeReport(LCOV);
    expect(await measure(repo, { worktreePath: worktree }, custom(command))).toEqual({
      status: 'measured',
      command,
      covered: 2,
      executable: 4,
      files: [
        { path: 'src/math.js', covered: 1, executable: 3, uncovered: [[5, 6]] },
        { path: 'src/fresh.js', covered: 1, executable: 1, uncovered: [] },
      ],
    });
  });

  test('a stale report from an earlier run is removed first, so a command that writes none is unavailable', async () => {
    const { repo, worktree } = await createChangedWorktree();
    mkdirSync(join(worktree, 'coverage'), { recursive: true });
    writeFileSync(join(worktree, 'coverage', 'lcov.info'), 'SF:src/math.js\nDA:2,1\nend_of_record\n');
    expect(await measure(repo, { worktreePath: worktree }, custom('exit 3'))).toEqual({
      status: 'unavailable',
      command: 'exit 3',
      reason: `It wrote no report at ${join(worktree, 'coverage', 'lcov.info')} (exit 3).`,
    });
  });

  test('a failing command whose report is there still counts: a coverage floor fails the run, not the report', async () => {
    const { repo, worktree } = await createChangedWorktree();
    const coverage = await measure(repo, { worktreePath: worktree }, custom(`${writeReport(LCOV)}; exit 1`));
    expect(coverage).toMatchObject({ status: 'measured', covered: 2, executable: 4 });
  });

  test('a report that lists no files, cannot be read or has a format its name does not tell is unavailable', async () => {
    const { repo, worktree } = await createChangedWorktree();
    expect(await measure(repo, { worktreePath: worktree }, custom(writeReport('TN:')))).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('lists no files'),
    });
    expect(
      await measure(repo, { worktreePath: worktree }, custom('mkdir -p coverage/lcov.info'))
    ).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('EISDIR') });
    expect(await measure(repo, { worktreePath: worktree }, custom('true', 'coverage/data'))).toEqual({
      status: 'unavailable',
      command: 'true',
      reason: 'Shinsa cannot tell the format of coverage/data from its name.',
    });
  });

  test('a command that runs too long is stopped and unavailable', async () => {
    const { repo, worktree } = await createChangedWorktree();
    const coverage = await measureTaskCoverage({
      repo: { ...repo, coverage: custom('sleep 5') },
      task: createTask({ branch: 'feat/sub', worktreePath: worktree }),
      ledgers: new LedgerStore(createTempDir()),
      baseBranch: null,
      signal: new AbortController().signal,
      timeoutMs: 50,
    });
    expect(coverage).toEqual({
      status: 'unavailable',
      command: 'sleep 5',
      reason: 'It ran too long and was stopped.',
    });
  });

  test('a task with no branch to diff measures nothing it can show', async () => {
    const { repo, worktree } = await createChangedWorktree();
    expect(
      await measure(repo, { worktreePath: worktree, branch: null }, custom(writeReport(LCOV)))
    ).toMatchObject({
      status: 'unavailable',
      reason: 'Shinsa could not find the commit the task’s branch started from.',
    });
  });

  test('off, Auto with nothing to detect, no checkout or a cancelled run record nothing', async () => {
    const { repo, worktree } = await createChangedWorktree();
    expect(await measure(repo, { worktreePath: worktree }, { mode: 'off' })).toBeNull();
    expect(await measure(repo, { worktreePath: worktree }, { mode: 'auto' })).toBeNull();
    expect(await measure(repo, { worktreePath: null }, custom('true'))).toBeNull();
    const stopped = new AbortController();
    stopped.abort();
    expect(await measure(repo, { worktreePath: worktree }, custom('true'), stopped.signal)).toBeNull();
    const cancel = new AbortController();
    const running = measure(
      repo,
      { worktreePath: worktree },
      custom('touch started && sleep 5'),
      cancel.signal
    );
    await until('the coverage command to start', () => existsSync(join(worktree, 'started')));
    cancel.abort();
    expect(await running).toBeNull();
  });

  test('Auto runs the detected command and reads its report from Shinsa’s own folder', async () => {
    const { repo, worktree } = await createChangedWorktree();
    writeFiles(worktree, {
      'package.json': JSON.stringify({ scripts: { test: 'bun test' } }),
      'src/math.test.js': [
        "import { expect, test } from 'bun:test';",
        "import { add } from './math.js';",
        "test('adds', () => expect(add(1, 2)).toBe(3));",
        '',
      ].join('\n'),
    });
    const coverage = await measureTaskCoverage({
      repo: { ...repo, coverage: { mode: 'auto' } },
      task: createTask({ branch: 'feat/sub', worktreePath: worktree }),
      ledgers: new LedgerStore(createTempDir()),
      baseBranch: null,
      signal: new AbortController().signal,
      timeoutMs: 30_000,
    });
    expect(coverage).toMatchObject({
      status: 'measured',
      command: expect.stringMatching(/^bun test --coverage/),
    });
    expect(existsSync(join(worktree, 'coverage'))).toBe(false);
    const math =
      coverage?.status === 'measured' ? coverage.files.find((file) => file.path === 'src/math.js') : null;
    expect(math?.uncovered.some(([start, end]) => start <= 6 && end >= 6)).toBe(true);
  });
});

const OTHER_HEADER = ['// another task', '// wrote these two lines', ''].join('\n');

const WORKSPACE_LCOV = [
  'SF:$PWD/src/math.js',
  'DA:1,0',
  'DA:2,0',
  'DA:3,4',
  'DA:4,4',
  'DA:5,4',
  'DA:7,0',
  'DA:8,0',
  'end_of_record',
  'SF:src/other.js',
  'DA:1,0',
  'DA:2,0',
  'end_of_record',
  'SF:src/stray.js',
  'DA:1,0',
  'end_of_record',
  'SF:src/fresh.js',
  'DA:1,1',
  'end_of_record',
].join('\\n');

async function createGitButlerWorkspace() {
  const { repo } = await createGitRepo({
    files: { 'src/math.js': SOURCE, 'src/other.js': 'export const other = 1;\n' },
  });
  const path = repo.path;
  await git(path, 'checkout', '-q', '-b', 'feat/sub', 'main');
  writeFiles(path, { 'src/math.js': CHANGED });
  await git(path, 'commit', '-qam', 'feat: sub');
  await git(path, 'checkout', '-q', '-b', 'feat/other', 'main');
  writeFiles(path, {
    'src/math.js': `${OTHER_HEADER}${SOURCE}`,
    'src/other.js': 'export const other = 2;\n',
  });
  await git(path, 'commit', '-qam', 'feat: other');
  await git(path, 'checkout', '-q', '-b', 'gitbutler/workspace', 'main');
  await git(path, 'merge', '-q', '--no-edit', 'feat/sub', 'feat/other');
  writeFiles(path, {
    'src/fresh.js': 'export const fresh = 1;\n',
    'src/other.js': 'export const other = 2;\nexport const more = 3;\n',
    'src/stray.js': 'export const stray = 1;\n',
  });
  const ledgers = new LedgerStore(createTempDir());
  ledgers.write(repo.id, {
    owners: {
      'src/fresh.js': { taskId: 'task-1', hash: 'fresh' },
      'src/other.js': { taskId: 'task-2', hash: 'other' },
    },
    baselines: {},
  });
  return { repo, ledgers };
}

describe('measuring a task in a GitButler workspace', () => {
  test('counts only the task’s own lines, where they sit in the shared checkout, never another task’s', async () => {
    const { repo, ledgers } = await createGitButlerWorkspace();
    const command = writeReport(WORKSPACE_LCOV);
    const task = { worktreePath: repo.path, workspace: 'gitbutler' as const };
    expect(await measure(repo, task, custom(command), undefined, ledgers)).toEqual({
      status: 'measured',
      command,
      covered: 2,
      executable: 4,
      files: [
        { path: 'src/math.js', covered: 1, executable: 3, uncovered: [[7, 8]] },
        { path: 'src/fresh.js', covered: 1, executable: 1, uncovered: [] },
      ],
    });
  });

  test('a task with nothing committed yet counts only the files it owns', async () => {
    const { repo, ledgers } = await createGitButlerWorkspace();
    await git(repo.path, 'branch', 'feat/empty', 'main');
    const command = writeReport(WORKSPACE_LCOV);
    const task = { branch: 'feat/empty', worktreePath: repo.path, workspace: 'gitbutler' as const };
    expect(await measure(repo, task, custom(command), undefined, ledgers)).toMatchObject({
      covered: 1,
      executable: 1,
      files: [{ path: 'src/fresh.js' }],
    });
    const unowned = { ...task, id: 'task-3' };
    expect(await measure(repo, unowned, custom(command), undefined, ledgers)).toMatchObject({
      covered: 0,
      executable: 0,
      files: [],
    });
  });
});
