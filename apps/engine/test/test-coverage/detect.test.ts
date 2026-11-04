import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Option } from 'effect';
import {
  resolveCoverageRun,
  selectCoverageDetection,
  selectGoModule,
} from '../../src/test-coverage/detect.ts';
import { runFiles } from '../harness.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

const detectionOf = async (path: string) => Option.getOrNull(await runFiles(selectCoverageDetection(path)));

const goModuleOf = async (path: string) => Option.getOrNull(await runFiles(selectGoModule(path)));

const DIR = '/tmp/report';

const ROOT = '/repo';

function createProject(files: Record<string, string>) {
  const path = createTempDir('shinsa-coverage-detect-');
  writeFiles(path, files);
  return path;
}

function manifest(fields: Record<string, unknown>) {
  return JSON.stringify(fields);
}

describe('turning a test check into its coverage run', () => {
  test("bun test keeps its paths and options, adds Bun's lcov report, and reads its --cwd", () => {
    expect(resolveCoverageRun('bun test apps/engine/test/checks --timeout 2000', ROOT, DIR)).toEqual({
      tool: "Bun's test runner",
      command:
        "bun test --coverage --coverage-reporter=lcov --coverage-dir='/tmp/report' apps/engine/test/checks --timeout 2000",
      cwd: ROOT,
      report: '/tmp/report/lcov.info',
      format: 'lcov',
    });
    expect(resolveCoverageRun('bun test --cwd apps/web test/a.test.ts', ROOT, DIR)?.cwd).toBe(
      '/repo/apps/web'
    );
    expect(resolveCoverageRun('bun test --cwd=apps/web', ROOT, DIR)?.cwd).toBe('/repo/apps/web');
    expect(resolveCoverageRun('  bun   test  ', ROOT, DIR)?.command).toBe(
      "bun test --coverage --coverage-reporter=lcov --coverage-dir='/tmp/report'"
    );
  });

  test('Vitest and Jest keep their runner prefix and write lcov; a folder with a quote is quoted', () => {
    expect(resolveCoverageRun('bunx vitest run src/paywalls', ROOT, DIR)).toMatchObject({
      tool: 'Vitest',
      command:
        "bunx vitest run --coverage.enabled=true --coverage.reporter=lcov --coverage.reportsDirectory='/tmp/report' src/paywalls",
    });
    expect(resolveCoverageRun('vitest src', ROOT, DIR)?.command).toStartWith(
      'vitest run --coverage.enabled=true'
    );
    expect(resolveCoverageRun('pnpm exec jest src/a.test.ts', ROOT, "/tmp/it's here")).toMatchObject({
      tool: 'Jest',
      command:
        "pnpm exec jest --coverage --coverageReporters=lcov --coverageDirectory='/tmp/it'\\''s here' src/a.test.ts",
    });
  });

  test('pytest writes Cobertura and go test a cover profile, each after its own options', () => {
    expect(resolveCoverageRun('uv run pytest tests/test_api.py', ROOT, DIR)).toEqual({
      tool: 'pytest-cov',
      command: "uv run pytest --cov=. --cov-report=xml:'/tmp/report/coverage.xml' tests/test_api.py",
      cwd: ROOT,
      report: '/tmp/report/coverage.xml',
      format: 'cobertura',
    });
    expect(resolveCoverageRun('go test ./internal/api/...', ROOT, DIR)).toEqual({
      tool: 'go test',
      command: "go test -coverprofile='/tmp/report/cover.out' ./internal/api/...",
      cwd: ROOT,
      report: '/tmp/report/cover.out',
      format: 'go',
    });
  });

  test('a cd before the runner moves where it runs and is kept in the command', () => {
    expect(resolveCoverageRun('cd apps/web && bunx vitest run src', ROOT, DIR)).toMatchObject({
      cwd: '/repo/apps/web',
      command: expect.stringMatching(/^cd apps\/web && bunx vitest run --coverage\.enabled=true/),
    });
  });

  test('anything that is not a plain test run is left alone', () => {
    for (const command of [
      'bun run lint',
      'bun --cwd apps/web test',
      'bunx biome check src',
      'go vet ./...',
      'sudo jest',
      'bun test a.test.ts | tee out.txt',
      'cd apps/web && bun test; rm -rf x',
      'make test',
    ]) {
      expect(resolveCoverageRun(command, ROOT, DIR)).toBeNull();
    }
  });
});

describe('the coverage tool Settings names for Auto', () => {
  test('a JavaScript repository names Vitest with a provider, Jest, or a bun test script', async () => {
    const vitest = createProject({
      'package.json': manifest({ devDependencies: { vitest: '^3', '@vitest/coverage-v8': '^3' } }),
    });
    expect(await detectionOf(vitest)).toEqual({
      tool: 'Vitest',
      command: "The test checks of each task, run once more with Vitest's coverage report.",
    });
    const jest = createProject({ 'package.json': manifest({ dependencies: { jest: '^29' } }) });
    expect((await detectionOf(jest))?.tool).toBe('Jest');
    const bun = createProject({ 'package.json': manifest({ scripts: { test: 'bun test --timeout 2000' } }) });
    expect((await detectionOf(bun))?.tool).toBe("Bun's test runner");
  });

  test('a package.json with no known runner, or one that is not JSON, names nothing', async () => {
    const bare = createProject({ 'package.json': manifest({ devDependencies: { vitest: '^3' } }) });
    expect(await detectionOf(bare)).toBeNull();
    expect(await detectionOf(createProject({ 'package.json': 'null' }))).toBeNull();
    expect(await detectionOf(createProject({ 'package.json': '{ not json' }))).toBeNull();
  });

  test('pytest-cov in a manifest or a requirements file, or a go.mod, names its tool', async () => {
    expect((await detectionOf(createProject({ 'requirements-dev.txt': 'pytest-cov==5.0\n' })))?.tool).toBe(
      'pytest-cov'
    );
    expect(await detectionOf(createProject({ 'pyproject.toml': '[project]\n' }))).toBeNull();
    const go = createProject({ 'go.mod': 'module github.com/acme/app\n\ngo 1.22\n' });
    expect((await detectionOf(go))?.tool).toBe('go test');
    expect(await goModuleOf(go)).toBe('github.com/acme/app');
    expect(await goModuleOf(createProject({}))).toBeNull();
  });

  test('a folder that is gone or has nothing to go on names nothing', async () => {
    expect(await detectionOf(join(createTempDir(), 'gone'))).toBeNull();
  });
});
