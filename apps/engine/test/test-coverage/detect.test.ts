import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { resolveCoveragePlan, resolveGoModule } from '../../src/test-coverage/detect.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

const DIR = '/tmp/report';

function createProject(files: Record<string, string>) {
  const path = createTempDir('shinsa-coverage-detect-');
  writeFiles(path, files);
  return path;
}

function manifest(fields: Record<string, unknown>) {
  return JSON.stringify(fields);
}

describe('detecting a coverage command', () => {
  test("a bun test script runs Bun's own coverage into Shinsa's folder, keeping the script's arguments", () => {
    const path = createProject({
      'package.json': manifest({ scripts: { test: 'bun test --timeout 2000' } }),
      'bun.lock': '',
    });
    expect(resolveCoveragePlan(path, DIR)).toEqual({
      tool: "Bun's test runner",
      command: "bun test --coverage --coverage-reporter=lcov --coverage-dir='/tmp/report' --timeout 2000",
      report: '/tmp/report/lcov.info',
      format: 'lcov',
    });
  });

  test('a c8 or nyc test script keeps its wrapper and adds an lcov report, run through the lockfile’s runner', () => {
    const c8 = createProject({
      'package.json': manifest({ scripts: { test: 'c8 node --test' } }),
      'pnpm-lock.yaml': '',
    });
    expect(resolveCoveragePlan(c8, DIR)?.command).toBe(
      "pnpm exec c8 --reporter=lcov --report-dir='/tmp/report' node --test"
    );
    const nyc = createProject({
      'package.json': manifest({ scripts: { test: 'nyc mocha' } }),
      'yarn.lock': '',
    });
    expect(resolveCoveragePlan(nyc, DIR)).toMatchObject({
      tool: 'nyc',
      command: "yarn nyc --reporter=lcov --report-dir='/tmp/report' mocha",
    });
  });

  test('Vitest needs a coverage provider among the dependencies, and runs once with an lcov report', () => {
    const bare = createProject({ 'package.json': manifest({ devDependencies: { vitest: '^3' } }) });
    expect(resolveCoveragePlan(bare, DIR)).toBeNull();
    const ready = createProject({
      'package.json': manifest({
        scripts: { test: 'vitest' },
        devDependencies: { vitest: '^3', '@vitest/coverage-v8': '^3' },
      }),
      'bun.lockb': '',
    });
    expect(resolveCoveragePlan(ready, DIR)).toEqual({
      tool: 'Vitest',
      command:
        "bunx vitest run --coverage --coverage.reporter=lcov --coverage.reportsDirectory='/tmp/report'",
      report: '/tmp/report/lcov.info',
      format: 'lcov',
    });
  });

  test('Jest has coverage built in; a test script with shell operators is not rewritten', () => {
    const path = createProject({
      'package.json': manifest({
        scripts: { test: 'tsc && jest' },
        dependencies: { jest: '^29' },
      }),
    });
    expect(resolveCoveragePlan(path, "/tmp/it's here")).toMatchObject({
      tool: 'Jest',
      command: "npx jest --coverage --coverageReporters=lcov --coverageDirectory='/tmp/it'\\''s here'",
    });
  });

  test('a package.json with no known runner, or one that is not JSON, detects nothing', () => {
    expect(resolveCoveragePlan(createProject({ 'package.json': manifest({}) }), DIR)).toBeNull();
    expect(
      resolveCoveragePlan(
        createProject({ 'package.json': manifest({ scripts: { test: 'turbo test' } }) }),
        DIR
      )
    ).toBeNull();
    expect(resolveCoveragePlan(createProject({ 'package.json': '{ not json' }), DIR)).toBeNull();
  });

  test('pytest-cov named in a manifest or a requirements file runs pytest with a Cobertura report', () => {
    const plain = createProject({ 'requirements-dev.txt': 'pytest\npytest-cov==5.0\n' });
    expect(resolveCoveragePlan(plain, DIR)).toEqual({
      tool: 'pytest-cov',
      command: "python3 -m pytest --cov=. --cov-report=xml:'/tmp/report/coverage.xml'",
      report: '/tmp/report/coverage.xml',
      format: 'cobertura',
    });
    const uv = createProject({
      'pyproject.toml': '[dependency-groups]\ndev = ["pytest_cov>=5"]\n',
      'uv.lock': '',
    });
    expect(resolveCoveragePlan(uv, DIR)?.command).toStartWith('uv run pytest --cov=.');
    expect(resolveCoveragePlan(createProject({ 'pyproject.toml': '[project]\n' }), DIR)).toBeNull();
  });

  test('a go.mod runs go test with a cover profile, and names the module', () => {
    const path = createProject({ 'go.mod': 'module github.com/acme/app\n\ngo 1.22\n' });
    expect(resolveCoveragePlan(path, DIR)).toEqual({
      tool: 'go test',
      command: "go test ./... -coverprofile='/tmp/report/cover.out'",
      report: '/tmp/report/cover.out',
      format: 'go',
    });
    expect(resolveGoModule(path)).toBe('github.com/acme/app');
    expect(resolveGoModule(createProject({}))).toBeNull();
  });

  test('a folder that is gone or has nothing to go on detects nothing', () => {
    expect(resolveCoveragePlan(join(createTempDir(), 'gone'), DIR)).toBeNull();
    expect(resolveCoveragePlan(createProject({ 'README.md': '# app' }), DIR)).toBeNull();
  });
});
