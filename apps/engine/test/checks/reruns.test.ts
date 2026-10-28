import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  isCoverageFloorOnly,
  isRerunPassed,
  listFailedTests,
  resolveRerunCommand,
} from '../../src/checks/reruns.ts';

const dirs: string[] = [];

function createRepo(files: Record<string, string>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shinsa-reruns-')));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MONOREPO = {
  'package.json': JSON.stringify({ workspaces: ['apps/*', 'packages/core', 'tools/**'] }),
  'apps/engine/package.json': JSON.stringify({ name: '@acme/engine' }),
  'apps/engine/test/a.test.ts': '',
  'apps/engine/test/index.test.ts': '',
  'apps/web/package.json': JSON.stringify({ name: '@acme/web', devDependencies: { vitest: '3' } }),
  'apps/web/test/index.test.ts': '',
  'apps/web/src/b.spec.tsx': '',
  'apps/notes.md': '',
  'packages/core/package.json': JSON.stringify({ name: '@acme/core' }),
  'packages/core/test/c.test.ts': '',
};

const BUN_SUMMARY = (fails: number) => ` 3 pass\n ${fails} fail\n Ran 4 tests across 2 files.`;

describe('reading which test files failed', () => {
  test('finds Bun files in a Turbo run by their package prefix, even when two packages share a path', () => {
    const root = createRepo(MONOREPO);
    const output = [
      '@acme/engine:test: bun test v1.4.4',
      '@acme/engine:test: test/index.test.ts:',
      '@acme/core:test: test/c.test.ts:',
      '@acme/engine:test: (fail) loads (fail) markers [5001.00ms]',
      '@acme/core:test: (fail) c > works [5002.00ms]',
      '@acme/engine:test:  1 fail',
      '@acme/core:test:  1 fail',
      '@acme/web:test: test/index.test.ts:',
    ].join('\n');
    expect(listFailedTests(output, root)).toEqual({
      kind: 'files',
      groups: [
        { runner: 'bun', packageDir: join(root, 'apps/engine'), files: ['test/index.test.ts'] },
        { runner: 'bun', packageDir: join(root, 'packages/core'), files: ['test/c.test.ts'] },
      ],
    });
  });

  test('reads Bun output grouped for GitHub Actions, alone or in a Turbo run', () => {
    const root = createRepo(MONOREPO);
    const alone = [
      'bun test v1.4.4',
      '::group::test/c.test.ts:',
      '(fail) c > works [1.00ms]',
      '::endgroup::',
      ' 1 fail',
    ];
    expect(listFailedTests(alone.join('\n'), join(root, 'packages/core'))).toEqual({
      kind: 'files',
      groups: [{ runner: 'bun', packageDir: join(root, 'packages/core'), files: ['test/c.test.ts'] }],
    });
    const turbo = [
      '@acme/core:test: bun test v1.4.4',
      '@acme/core:test: ::group::test/c.test.ts:',
      '@acme/core:test: (fail) c > works [1.00ms]',
      '@acme/core:test: ::endgroup::',
      '@acme/core:test:  1 fail',
    ];
    expect(listFailedTests(turbo.join('\n'), root)).toEqual({
      kind: 'files',
      groups: [{ runner: 'bun', packageDir: join(root, 'packages/core'), files: ['test/c.test.ts'] }],
    });
  });

  test('finds Vitest and Jest files, and the runner from the package', () => {
    const root = createRepo({
      ...MONOREPO,
      'apps/jest/package.json': JSON.stringify({ name: 'jest-app', scripts: { test: 'jest' } }),
      'apps/jest/src/d.test.js': '',
    });
    const output = [
      ' FAIL  |web| src/b.spec.tsx > renders',
      ' FAIL  src/b.spec.tsx > renders again',
      'FAIL apps/jest/src/d.test.js (5.1 s)',
    ].join('\n');
    expect(listFailedTests(output, root)).toEqual({
      kind: 'files',
      groups: [
        { runner: 'vitest', packageDir: join(root, 'apps/web'), files: ['src/b.spec.tsx'] },
        { runner: 'jest', packageDir: join(root, 'apps/jest'), files: ['src/d.test.js'] },
      ],
    });
  });

  test('reads pnpm workspaces and absolute paths inside the repository', () => {
    const root = createRepo({
      'pnpm-workspace.yaml': "packages:\n  - 'libs/*'\n  # a comment\n",
      'libs/one/package.json': JSON.stringify({ name: 'one', dependencies: { jest: '29' } }),
      'libs/one/e.test.ts': '',
    });
    expect(listFailedTests('FAIL e.test.ts', root)).toEqual({
      kind: 'files',
      groups: [{ runner: 'jest', packageDir: join(root, 'libs/one'), files: ['e.test.ts'] }],
    });
    expect(listFailedTests(`FAIL ${join(root, 'libs/one/e.test.ts')}`, root)).toEqual({
      kind: 'files',
      groups: [{ runner: 'jest', packageDir: join(root, 'libs/one'), files: ['e.test.ts'] }],
    });
    expect(listFailedTests('FAIL /elsewhere/e.test.ts', root)).toEqual({ kind: 'unknown' });
  });

  test('a package.json object of workspaces is read too', () => {
    const root = createRepo({
      'package.json': JSON.stringify({ workspaces: { packages: ['pkg'] }, scripts: { test: 'bun test' } }),
      'pkg/package.json': '{}',
      'pkg/a.test.ts': '',
    });
    const output = ['pkg/a.test.ts:', '(fail) a', BUN_SUMMARY(1)].join('\n');
    expect(listFailedTests(output, root)).toEqual({
      kind: 'files',
      groups: [{ runner: 'bun', packageDir: join(root, 'pkg'), files: ['a.test.ts'] }],
    });
  });

  test('says it cannot tell when a failure is not tied to a file it can find', () => {
    const root = createRepo(MONOREPO);
    const cases = [
      '(fail) no header [1ms]\n 1 fail',
      'test/index.test.ts:\n(fail) one\n 2 fail',
      '# Unhandled error between tests\n 0 fail',
      'test/missing.test.ts:\n(fail) gone\n 1 fail',
      ' FAIL  src/b.spec.tsx\nERROR: Coverage for lines (50%) does not meet global threshold (90%)',
      'FAIL apps/notes.test.ts',
      'not json at all\nFAIL test/index.test.ts',
    ];
    for (const output of cases) expect(listFailedTests(output, root)).toEqual({ kind: 'unknown' });
  });

  test('a file in no package, or in a package with no known runner, cannot be re-run alone', () => {
    const root = createRepo({ 'test/a.test.ts': '', 'pkg/package.json': '{}', 'pkg/b.test.ts': '' });
    expect(listFailedTests('FAIL test/a.test.ts', root)).toEqual({ kind: 'unknown' });
    expect(listFailedTests('FAIL pkg/b.test.ts', root)).toEqual({ kind: 'unknown' });
    expect(listFailedTests('FAIL pkg/b.test.ts', join(root, 'nowhere'))).toEqual({ kind: 'unknown' });
    const listed = createRepo({ 'package.json': '[]', 'b.test.ts': '' });
    expect(listFailedTests('FAIL b.test.ts', listed)).toEqual({ kind: 'unknown' });
  });

  test('a Bun run that also fell below a coverage floor still names its failing files', () => {
    const files = {
      'package.json': '{}',
      'a.test.ts': '',
      'bunfig.toml': '[test]\ncoverageThreshold = 1.0\n',
    };
    const output = ['a.test.ts:', '(fail) a', 'All files  |   90.00 |  100.00 |', ' 1 fail'].join('\n');
    expect(listFailedTests(output, createRepo(files)).kind).toBe('files');
  });

  test('a scoped Bun run that failed only its coverage floor is told apart from a failing one', () => {
    const floor = ['bun test v1.4.4', 'All files  |   61.20 |   70.03 |', ' 6 pass', ' 0 fail'].join('\n');
    expect(isCoverageFloorOnly(floor)).toBe(true);
    expect(isCoverageFloorOnly(floor.replace('61.20 |   70.03', '100.00 |  100.00'))).toBe(false);
    expect(
      isCoverageFloorOnly(['a.test.ts:', '(fail) a', 'All files  |  61.20 |  70.03 |', ' 1 fail'].join('\n'))
    ).toBe(false);
    expect(isCoverageFloorOnly(`${floor}\n# Unhandled error between tests`)).toBe(false);
    expect(isCoverageFloorOnly('All files  |   61.20 |   70.03 |')).toBe(false);
    expect(isCoverageFloorOnly('bun test v1.4.4\nAll files  |   61.20 |   70.03 |')).toBe(false);
  });

  test('a recap of failures after the run is not counted twice', () => {
    const root = createRepo({ 'package.json': '{}', 'a.test.ts': '' });
    const output = ['a.test.ts:', '(fail) a', '1 test failed:', '(fail) a', ' 1 fail'].join('\n');
    expect(listFailedTests(output, root)).toEqual({
      kind: 'files',
      groups: [{ runner: 'bun', packageDir: root, files: ['a.test.ts'] }],
    });
  });

  test('Bun output with no failed test is a failure elsewhere; output from no test runner is none', () => {
    const root = createRepo({ 'package.json': '{}' });
    expect(listFailedTests('bun test v1.4.4\n 4 pass\n 0 fail', root)).toEqual({ kind: 'clean' });
    expect(listFailedTests('src/a.ts(3,1): error TS2322', root)).toEqual({ kind: 'none' });
  });
});

describe('re-running failed files', () => {
  test('Bun runs the files by path, Vitest and Jest from the nearest installed binary, without coverage', () => {
    const root = createRepo({
      'node_modules/.bin/vitest': '',
      'apps/web/node_modules/.bin/jest': '',
    });
    const web = join(root, 'apps/web');
    expect(resolveRerunCommand({ runner: 'bun', packageDir: web, files: ['a.test.ts'] }, root)).toEqual([
      'bun',
      'test',
      './a.test.ts',
    ]);
    expect(resolveRerunCommand({ runner: 'vitest', packageDir: web, files: ['b.spec.ts'] }, root)).toEqual([
      join(root, 'node_modules/.bin/vitest'),
      'run',
      '--coverage.enabled=false',
      'b.spec.ts',
    ]);
    expect(resolveRerunCommand({ runner: 'jest', packageDir: web, files: ['c.test.js'] }, root)).toEqual([
      join(web, 'node_modules/.bin/jest'),
      '--coverage=false',
      '--runTestsByPath',
      'c.test.js',
    ]);
    const bare = createRepo({});
    expect(resolveRerunCommand({ runner: 'jest', packageDir: bare, files: ['c.test.js'] }, bare)).toBeNull();
  });

  test('a Bun re-run passes on its counts, whatever a coverage floor did to the exit code', () => {
    expect(isRerunPassed('bun', ' 1 pass\n 0 fail', false)).toBe(true);
    expect(isRerunPassed('bun', '(fail) a\n 1 fail', false)).toBe(false);
    expect(isRerunPassed('bun', '# Unhandled error between tests\n 0 fail', true)).toBe(false);
    expect(isRerunPassed('bun', 'error: crashed', false)).toBe(false);
    expect(isRerunPassed('vitest', 'whatever', true)).toBe(true);
    expect(isRerunPassed('jest', 'whatever', false)).toBe(false);
  });
});
