import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CoverageSetting, Repo, Task } from '@shinsa/core';
import { Layer, ManagedRuntime } from 'effect';
import { ChecksLayer } from '../../src/checks/layers.ts';
import { GitLayer } from '../../src/git/layers.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import { type CoverageRequest, listCoverageDetections, TaskCoverage } from '../../src/test-coverage/index.ts';
import { runFiles } from '../harness.ts';
import { createWorktree } from '../helpers/git.ts';
import { createGitRepo, createTempDir, git, until, writeFiles } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

const runtime = ManagedRuntime.make(
  Layer.merge(ChecksLayer.pipe(Layer.provide(GitLayer), Layer.provide(ShellLayer)), JsonLogger)
);

function measureTaskCoverage(request: CoverageRequest) {
  return runtime.runPromise(TaskCoverage.use((coverage) => coverage.measure(request)));
}

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
  commands: string[] = []
) {
  return measureTaskCoverage({
    repo: { ...repo, coverage },
    task: createTask({ branch: 'feat/sub', ...task }),
    commands,
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
    expect(
      await measure(repo, { worktreePath: worktree }, custom('true', 'src/math.js/lcov.info'))
    ).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('math.js/lcov.info') });
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
      commands: [],
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

  test('off, Auto with no test among the checks, no checkout or a cancelled run record nothing', async () => {
    const { repo, worktree } = await createChangedWorktree();
    expect(
      await measure(repo, { worktreePath: worktree }, { mode: 'off' }, undefined, ['bun test'])
    ).toBeNull();
    const lint = ['bunx biome check src', 'bun run lint'];
    expect(await measure(repo, { worktreePath: worktree }, { mode: 'auto' }, undefined, lint)).toBeNull();
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

  test('Auto runs the test checks again with coverage, merging their reports, and leaves the checkout clean', async () => {
    const { repo, worktree } = await createChangedWorktree();
    writeFiles(worktree, {
      'package.json': '{}',
      'src/math.test.js': [
        "import { expect, test } from 'bun:test';",
        "import { add } from './math.js';",
        "test('adds', () => expect(add(1, 2)).toBe(3));",
        '',
      ].join('\n'),
      'src/sub.test.js': [
        "import { expect, test } from 'bun:test';",
        "import { sub } from './math.js';",
        "test('subtracts', () => expect(sub(3, 2)).toBe(1));",
        '',
      ].join('\n'),
    });
    const commands = ['bun test src/math.test.js', 'bun test --cwd src sub.test.js', 'bunx biome check src'];
    const coverage = await measure(repo, { worktreePath: worktree }, { mode: 'auto' }, undefined, [
      ...commands,
      commands[0] ?? '',
    ]);
    const command = coverage?.status === 'measured' ? coverage.command : '';
    expect(command.split('\n').map((line) => line.slice(0, 19))).toEqual([
      'bun test --coverage',
      'bun test --coverage',
    ]);
    expect(existsSync(join(worktree, 'coverage'))).toBe(false);
    const math =
      coverage?.status === 'measured' ? coverage.files.find((file) => file.path === 'src/math.js') : null;
    expect(math?.uncovered).toEqual([]);
  });

  test('a test check that writes no report is skipped when another wrote one, and named when none did', async () => {
    const { repo, worktree } = await createChangedWorktree();
    writeFiles(worktree, {
      'package.json': '{}',
      'src/math.test.js': "import { test } from 'bun:test';\nimport './math.js';\ntest('loads', () => {});\n",
    });
    const auto = { mode: 'auto' } as const;
    const none = await measure(repo, { worktreePath: worktree }, auto, undefined, ['go test ./nothing']);
    expect(none).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('It wrote no report at'),
    });
    const some = await measure(repo, { worktreePath: worktree }, auto, undefined, [
      'go test ./nothing',
      'bun test src/math.test.js',
    ]);
    expect(some).toMatchObject({ status: 'measured' });
  });
});

describe('the coverage each repository would measure', () => {
  test('names the runner found in each repository, and none where there is none', async () => {
    const bun = createTempDir();
    writeFiles(bun, { 'package.json': JSON.stringify({ scripts: { test: 'bun test' } }) });
    const bare = createTempDir();
    expect(
      await runFiles(
        listCoverageDetections([
          { id: 'bun', path: bun },
          { id: 'bare', path: bare },
        ])
      )
    ).toEqual({
      bun: {
        tool: "Bun's test runner",
        command: "The test checks of each task, run once more with Bun's test runner's coverage report.",
      },
      bare: null,
    });
  });
});
