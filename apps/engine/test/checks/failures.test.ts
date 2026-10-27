import { describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CheckFailure,
  describeFailureDiff,
  listCheckFailures,
  resolveFailureDiff,
} from '../../src/checks/failures.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

const ROOT = '/work/task';

function diffOf(now: string, onBase: string, root = ROOT) {
  return resolveFailureDiff(listCheckFailures(now, root) ?? [], listCheckFailures(onBase, root) ?? []);
}

function labelsOf(failures: readonly CheckFailure[] | null) {
  return failures?.map((failure) => failure.label) ?? null;
}

const ESC = String.fromCharCode(27);

describe('reading the errors a check printed', () => {
  test('tsc errors, plain or pretty, are keyed by file, code and message, never by line', () => {
    const plain = 'src/a.ts(3,7): error TS2322: Type string is not assignable to type number.';
    const pretty = `${ESC}[96msrc/a.ts${ESC}[0m:${ESC}[93m40${ESC}[0m:${ESC}[93m1${ESC}[0m - ${ESC}[91merror${ESC}[0m${ESC}[90m TS2322: ${ESC}[0mType string is not assignable to type number.`;
    const [first] = listCheckFailures(plain, ROOT) ?? [];
    const [second] = listCheckFailures(pretty, ROOT) ?? [];
    expect(first).toEqual({
      kind: 'type',
      file: 'src/a.ts',
      key: 'src/a.ts\nTS2322\nType string is not assignable to type number.',
      label: 'src/a.ts: TS2322 Type string is not assignable to type number.',
    });
    expect(second?.key).toBe(first?.key);
    const turbo = listCheckFailures('@acme/web:check-types: app/(auth)/page.tsx(1,1): error TS2304: x', ROOT);
    expect(labelsOf(turbo)).toEqual(['app/(auth)/page.tsx: TS2304 x']);
  });

  test('biome diagnostics take their rule and the first message line under the header', () => {
    const output = [
      'src/a.ts:1:1 lint/style/useConst  FIXABLE  ━━━━━━━━━━━━',
      '',
      '  ! This let declares a variable that is only assigned once.',
      '  > 1 │ let a = 1;',
      '  i Safe fix: Use const instead.',
      'src/b.ts format ━━━━━━━━━━━━',
      'src/c.ts:9:2 lint/suspicious/noDebugger ━━━━━━━━━━━━',
      '  ✖ This is an unexpected use of the debugger statement.',
      'Checked 3 files in 2ms. No fixes applied.',
      'src/e.ts:29:12 plugin ━━━━━━━━━━━━',
      '  × Ternaries never wrap awaited calls.',
      'src/d.ts:1:1 parse ━━━━━━━━━━━━',
    ].join('\n');
    expect(labelsOf(listCheckFailures(output, ROOT))).toEqual([
      'src/a.ts: lint/style/useConst This let declares a variable that is only assigned once.',
      'src/b.ts: format',
      'src/c.ts: lint/suspicious/noDebugger This is an unexpected use of the debugger statement.',
      'src/e.ts: plugin Ternaries never wrap awaited calls.',
      'src/d.ts: parse',
    ]);
  });

  test('eslint’s stylish blocks, prettier’s list and any path:line diagnostic are read too', () => {
    const output = [
      '/work/task/src/a.ts',
      "  3:7   error    'x' is assigned a value but never used  @typescript-eslint/no-unused-vars",
      '  9:1   error    Parsing error: Unexpected token',
      '',
      '[warn] src/b.css',
      './main.go:3:2: undefined: thing',
      'app.py:12: error: Name "y" is not defined, see line 4  [name-defined]',
      '      at run (src/stack.ts:3:5)',
      'http://localhost:5180 is ready',
      '✖ 2 problems (2 errors, 0 warnings)',
    ].join('\n');
    expect(listCheckFailures(output, ROOT)?.map(({ kind, label }) => [kind, label])).toEqual([
      ['lint', "src/a.ts: @typescript-eslint/no-unused-vars 'x' is assigned a value but never used"],
      ['lint', 'src/a.ts: Parsing error: Unexpected token'],
      ['lint', 'src/b.css: prettier'],
      ['error', 'main.go: undefined: thing'],
      ['error', 'app.py: error: Name "y" is not defined, see line # [name-defined]'],
    ]);
  });

  test('output with no error Shinsa can name reads as nothing, so the failure is never compared', () => {
    expect(
      listCheckFailures('Segmentation fault\nerror: script "lint" exited with code 139', ROOT)
    ).toBeNull();
    expect(listCheckFailures('', ROOT)).toBeNull();
  });

  test('a test run is read by failing test names, each once', () => {
    const root = realpathSync(createTempDir('shinsa-failures-'));
    writeFiles(root, { 'package.json': '{}', 'test/a.test.ts': '' });
    const output = [
      'bun test v1.4.4',
      'test/a.test.ts:',
      '(fail) parser > reads merged state [1.20ms]',
      '(fail) parser > reads merged state [1.30ms]',
      ' 2 fail',
      'src/a.ts(3,7): error TS2322: ignored, the tests name the failure.',
    ].join('\n');
    expect(listCheckFailures(output, root)).toEqual([
      {
        kind: 'test',
        file: 'test/a.test.ts',
        key: 'test/a.test.ts\nparser > reads merged state',
        label: 'test/a.test.ts › parser > reads merged state',
      },
    ]);
  });

  test('jest and vitest failures are named by the tests under each FAIL line, or by the file alone', () => {
    const root = realpathSync(createTempDir('shinsa-failures-'));
    writeFiles(root, {
      'package.json': JSON.stringify({ devDependencies: { jest: '29' } }),
      'test/a.test.js': '',
      'test/b.test.js': '',
    });
    const jest = [
      `FAIL ${join(root, 'test/a.test.js')} (5.2 s)`,
      '  ● Console',
      '  ● parser › reads merged state',
      'FAIL test/b.test.js',
      'FAIL test/a.test.js > parser > reads open state',
    ].join('\n');
    expect(labelsOf(listCheckFailures(jest, root))).toEqual([
      'test/a.test.js',
      'test/a.test.js › parser › reads merged state',
      'test/b.test.js',
      'test/a.test.js › parser > reads open state',
    ]);
  });
});

describe('comparing the errors with the base branch', () => {
  test('errors that only moved lines are already on the base; a repeated one counts each time', () => {
    const now = [
      'src/a.ts(40,1): error TS2322: Type string is not assignable.',
      'src/a.ts(52,1): error TS2322: Type string is not assignable.',
      'src/b.ts(2,1): error TS2304: Cannot find name x.',
    ].join('\n');
    const onBase =
      'src/a.ts(3,1): error TS2322: Type string is not assignable.\nsrc/c.ts(1,1): error TS1: gone';
    const diff = diffOf(now, onBase);
    expect(labelsOf(diff.known)).toEqual(['src/a.ts: TS2322 Type string is not assignable.']);
    expect(labelsOf(diff.added)).toEqual([
      'src/a.ts: TS2322 Type string is not assignable.',
      'src/b.ts: TS2304 Cannot find name x.',
    ]);
    expect(describeFailureDiff(diff)).toBe(
      '2 new type errors, 1 already on the base branch:\n- src/a.ts: TS2322 Type string is not assignable.\n- src/b.ts: TS2304 Cannot find name x.'
    );
  });

  test('a base checkout’s absolute paths compare with the change’s relative ones', () => {
    const diff = diffOf(
      'src/a.ts:3:1: oops',
      '/work/base/src/a.ts:9:1: oops\n/elsewhere/a.ts:1: oops',
      '/work/base'
    );
    expect(diff.added).toEqual([]);
    expect(describeFailureDiff(diff)).toBe('1 error, all already on the base branch.');
  });

  test('the summary names the kind of failure, mixed kinds as errors, and lists ten new ones at most', () => {
    const lint = 'src/a.ts:1:1 lint/style/useConst ━━━━\n  ! Use const.';
    expect(describeFailureDiff(diffOf(lint, ''))).toBe(
      '1 new lint error, none on the base branch:\n- src/a.ts: lint/style/useConst Use const.'
    );
    const many = Array.from({ length: 12 }, (_, index) => `src/f${index}.ts(1,1): error TS1: bad`).join('\n');
    const mixed = `${many}\nsrc/x.py:1: bad`;
    const summary = describeFailureDiff(diffOf(mixed, 'src/x.py:1: bad'));
    expect(summary.split('\n')[0]).toBe('12 new errors, 1 already on the base branch:');
    expect(summary.endsWith('- src/f9.ts: TS1 bad\n- and 2 more')).toBe(true);
  });
});
