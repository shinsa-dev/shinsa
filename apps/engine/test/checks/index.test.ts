import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckToRun } from '@shinsa/core';
import {
  type CheckRun,
  confirmFailure,
  listFailedFiles,
  resolveInstallCommand,
  runCheck,
  runChecks,
  tailOutput,
} from '../../src/checks/index.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

const OPTIONS = { timeoutMs: 60_000 };

function checkOf(command: string, id = 'c1'): CheckToRun {
  return { id, label: `Label of ${id}`, command };
}

function createDir() {
  return realpathSync(createTempDir('shinsa-checks-'));
}

const FLAKY_TEST = `import { expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
test('passes once warmed up', () => {
  const marker = new URL('./warm', import.meta.url).pathname;
  const warm = existsSync(marker);
  writeFileSync(marker, '');
  expect(warm).toBe(true);
});
`;

const BROKEN_TEST = `import { expect, test } from 'bun:test';
test('is broken', () => {
  expect(1).toBe(2);
});
`;

function countRunsCommand(dir: string, script: string) {
  return `echo run >> ${join(dir, 'runs.log')}; ${script}`;
}

function readRuns(dir: string) {
  return readFileSync(join(dir, 'runs.log'), 'utf8').trim().split('\n').length;
}

describe('running a check', () => {
  test('a failing command keeps the tail of its output; a passing one is named by its check', async () => {
    const dir = createDir();
    const failed = await runCheck(checkOf("echo 'src/a.ts(3,1): error TS2322' >&2; exit 2"), dir, OPTIONS);
    expect(failed.check).toEqual({
      id: 'c1',
      label: 'Label of c1',
      command: "echo 'src/a.ts(3,1): error TS2322' >&2; exit 2",
      outcome: 'fail',
      detail: 'src/a.ts(3,1): error TS2322',
    });
    expect(failed.failedFiles).toBeNull();
    expect(failed.failures).toBeNull();
    expect(await runCheck(checkOf('echo all good'), dir, OPTIONS)).toEqual({
      check: { id: 'c1', label: 'Label of c1', command: 'echo all good', outcome: 'pass', detail: null },
      output: 'all good',
      timedOut: false,
      failedFiles: [],
      failures: [],
    });
  });

  test('a check that runs too long is stopped and says so; a silent failure gives its exit code', async () => {
    const dir = createDir();
    const slow = await runCheck(checkOf('echo started; sleep 30'), dir, { timeoutMs: 100 });
    expect(slow.check.detail).toBe('Stopped after 0 minutes.\nstarted');
    expect(slow.timedOut).toBe(true);
    expect(await confirmFailure(slow, dir, OPTIONS)).toBe(slow);
    expect((await runCheck(checkOf('exit 7'), dir, OPTIONS)).check.detail).toBe('exit 7');
  });

  test('a scoped Bun run that only missed its package’s coverage floor passes, and says the floor is CI’s', async () => {
    const dir = createDir();
    writeFiles(dir, {
      'package.json': '{}',
      'bunfig.toml': '[test]\ncoverage = true\ncoverageThreshold = { lines = 1.0 }\n',
      'a.ts': 'export function used() {\n  return 1;\n}\nexport function unused() {\n  return 2;\n}\n',
      'a.test.ts':
        "import { expect, test } from 'bun:test';\nimport { used } from './a.ts';\ntest('used', () => expect(used()).toBe(1));\n",
    });
    const run = await runCheck(checkOf('bun test ./a.test.ts'), dir, OPTIONS);
    expect(run.check).toMatchObject({
      outcome: 'pass',
      detail:
        'Every test passed. Only the coverage floor failed, which a scoped run cannot meet: CI checks it on the whole suite.',
    });
  });

  test('runs every check at low priority', async () => {
    const dir = createDir();
    const own = Number((await runCheck(checkOf(`ps -o nice= -p ${process.pid}`), dir, OPTIONS)).output);
    const run = await runCheck(checkOf('ps -o nice= -p $$'), dir, OPTIONS);
    expect(Number(run.output)).toBe(Math.min(19, own + 10));
  });

  test('the checks of a round run at once, in the checkout, each keeping its id and label', async () => {
    const dir = createDir();
    const marker = join(dir, 'started');
    const waiter = checkOf(`while [ ! -f ${marker} ]; do sleep 0.05; done; echo waited`, 'c1');
    const starter = checkOf(`touch ${marker}`, 'c2');
    const runs = await runChecks([waiter, starter, checkOf('test -f missing.txt', 'r1')], dir, OPTIONS);
    expect(runs.map((run) => [run.check.id, run.check.outcome])).toEqual([
      ['c1', 'pass'],
      ['c2', 'pass'],
      ['r1', 'fail'],
    ]);
    expect(existsSync(marker)).toBe(true);
  });

  test('two checks with the same command run it once and share the result', async () => {
    const dir = createDir();
    const command = countRunsCommand(dir, 'true');
    const runs = await runChecks([checkOf(command, 'c1'), checkOf(command, 'r1')], dir, OPTIONS);
    expect(runs.map((run) => run.check.id)).toEqual(['c1', 'r1']);
    expect(runs[1]?.check.label).toBe('Label of r1');
    expect(readRuns(dir)).toBe(1);
  });
});

describe('a failing check is confirmed before it counts', () => {
  test('a test file that fails in the full run and passes alone counts as passed, and says so', async () => {
    const dir = createDir();
    writeFiles(dir, { 'package.json': '{}', 'test/a.test.ts': FLAKY_TEST });
    const [run] = await runChecks([checkOf('bun test')], dir, OPTIONS);
    expect(run?.check).toEqual({
      id: 'c1',
      label: 'Label of c1',
      command: 'bun test',
      outcome: 'pass',
      detail: '1 test file failed in the full run and passed when re-run alone: test/a.test.ts.',
      note: 'passed_alone',
    });
    expect(run?.output).toContain('Re-run alone:');
  });

  test('only the files that fail again count; the ones that passed alone are named too', async () => {
    const dir = createDir();
    writeFiles(dir, {
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/one/package.json': '{}',
      'packages/one/a.test.ts': FLAKY_TEST,
      'packages/two/package.json': '{}',
      'packages/two/b.test.ts': BROKEN_TEST,
    });
    const [run] = await runChecks([checkOf('bun test')], dir, OPTIONS);
    expect(run?.check.outcome).toBe('fail');
    expect(run?.check.note).toBeUndefined();
    expect(run?.failedFiles).toEqual(['packages/two/b.test.ts']);
    expect(run?.check.detail).toStartWith(
      'Failed again when re-run alone: packages/two/b.test.ts.\nPassed when re-run alone: packages/one/a.test.ts.\n'
    );
    expect(run?.check.detail).toContain('(fail) is broken');
  });

  test('a file failing again with none passing alone names only the failing file', async () => {
    const dir = createDir();
    writeFiles(dir, { 'package.json': '{}', 'b.test.ts': BROKEN_TEST });
    const [run] = await runChecks([checkOf('bun test')], dir, OPTIONS);
    expect(run?.check.detail).toStartWith('Failed again when re-run alone: b.test.ts.\n');
    expect(run?.check.detail).not.toContain('Passed when re-run alone');
  });

  test('failures Shinsa cannot tie to a file, or that need a runner it cannot find, run once', async () => {
    const dir = createDir();
    writeFiles(dir, { 'package.json': JSON.stringify({ devDependencies: { jest: '29' } }), 'a.test.js': '' });
    const lint = countRunsCommand(dir, "echo 'src/a.ts(3,1): error TS2322'; exit 2");
    const jest = countRunsCommand(dir, 'echo FAIL a.test.js; exit 1');
    const runs = await runChecks([checkOf(lint, 'c1'), checkOf(jest, 'c2')], dir, OPTIONS);
    expect(runs.map((run) => run.check.outcome)).toEqual(['fail', 'fail']);
    expect(runs[1]?.failedFiles).toEqual(['a.test.js']);
    expect(readRuns(dir)).toBe(2);
  });

  test('a cancelled re-run leaves the first result as it was', async () => {
    const dir = createDir();
    writeFiles(dir, { 'package.json': '{}', 'b.test.ts': BROKEN_TEST });
    const failed = await runCheck(checkOf('bun test'), dir, OPTIONS);
    const controller = new AbortController();
    controller.abort();
    expect(await confirmFailure(failed, dir, { ...OPTIONS, signal: controller.signal })).toBe(failed);
  });
});

describe('comparing a failure with the base commit', () => {
  test('a failure whose errors all fail on the base too is noted and stops blocking; others are left alone', async () => {
    const dir = createDir();
    const asked: CheckRun[] = [];
    const known = { kind: 'type', file: 'src/a.ts', key: 'k', label: 'src/a.ts: TS2322 Bad.' } as const;
    const runs = await runChecks(
      [checkOf('exit 1', 'c1'), checkOf('exit 2', 'c2'), checkOf('true', 'c3')],
      dir,
      {
        ...OPTIONS,
        compare: (run) => {
          asked.push(run);
          return Promise.resolve(
            run.check.command === 'exit 1' ? { added: [], known: [known, known] } : null
          );
        },
      }
    );
    expect(runs[0]?.check).toMatchObject({
      outcome: 'fail',
      note: 'fails_on_base',
      detail: '2 type errors, all already on the base branch.\n\nexit 1',
    });
    expect(runs[1]?.check.note).toBeUndefined();
    expect(asked.map((run) => run.check.command).sort()).toEqual(['exit 1', 'exit 2']);
  });

  test('new errors on top of the base’s keep the check blocking and are named first', async () => {
    const dir = createDir();
    const tsc = [
      'src/a.ts(3,1): error TS2322: Type string is not assignable.',
      'src/a.ts(9,1): error TS2304: Cannot find name x.',
    ];
    const command = `printf '${tsc.join('\\n')}\\n'; exit 2`;
    const [run] = await runChecks([checkOf(command)], dir, {
      ...OPTIONS,
      compare: (current) => {
        const [first, second] = current.failures ?? [];
        return Promise.resolve(first && second ? { added: [second], known: [first] } : null);
      },
    });
    expect(run?.check.note).toBeUndefined();
    expect(run?.check.detail).toStartWith(
      '1 new type error, 1 already on the base branch:\n- src/a.ts: TS2304 Cannot find name x.\n\nsrc/a.ts(3,1)'
    );
  });

  test('a test command that ran no tests is never blamed on the base: its command needs fixing', async () => {
    const dir = createDir();
    writeFiles(dir, { 'package.json': '{}' });
    const [run] = await runChecks([checkOf('bun test ./missing/folder.test.ts')], dir, {
      ...OPTIONS,
      compare: () => Promise.resolve({ added: [], known: [] }),
    });
    expect(run?.check.outcome).toBe('fail');
    expect(run?.check.note).toBeUndefined();
  });

  test('a check stopped for time is never compared', async () => {
    const dir = createDir();
    let asked = false;
    const [run] = await runChecks([checkOf('sleep 30')], dir, {
      timeoutMs: 100,
      compare: () => {
        asked = true;
        return Promise.resolve(null);
      },
    });
    expect(run?.check.note).toBeUndefined();
    expect(asked).toBe(false);
  });
});

describe('output and setup', () => {
  test('long output is cut to its end and keeps the failing lines far from the end', () => {
    expect(tailOutput('  short  ')).toBe('short');
    expect(tailOutput('x'.repeat(5000)).startsWith('…\n')).toBe(true);
    const text = [
      '(fail) parser > reads merged state',
      'expected merged, received open',
      ...Array.from({ length: 400 }, (_, index) => `noise line ${index} ${'x'.repeat(20)}`),
    ].join('\n');
    const output = tailOutput(text);
    expect(output).toContain('(fail) parser > reads merged state');
    expect(output.endsWith('noise line 399 xxxxxxxxxxxxxxxxxxxx')).toBe(true);
  });

  test('a failing test file is named relative to the checkout; other output names none', () => {
    const dir = createDir();
    writeFiles(dir, { 'package.json': '{}', 'test/a.test.ts': '' });
    const output = 'bun test v1.4.4\ntest/a.test.ts:\n(fail) a > b\n 0 pass\n 1 fail';
    expect(listFailedFiles(output, dir)).toEqual(['test/a.test.ts']);
    expect(listFailedFiles('error TS2322', dir)).toBeNull();
  });

  test('dependencies install with the lockfile’s package manager, and yarn is left to the agent', () => {
    for (const [lockfile, install] of [
      ['bun.lock', ['bun', 'install']],
      ['pnpm-lock.yaml', ['pnpm', 'install', '--frozen-lockfile']],
      ['package-lock.json', ['npm', 'ci']],
      ['yarn.lock', null],
    ] as const) {
      const dir = createDir();
      writeFiles(dir, { [lockfile]: '' });
      expect(resolveInstallCommand(dir)).toEqual(install ? [...install] : null);
    }
  });
});
