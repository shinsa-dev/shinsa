import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CoverageFormat } from '@shinsa/core';

export interface CoveragePlan {
  tool: string;
  command: string;
  report: string;
  format: CoverageFormat;
}

interface PackageManifest {
  scripts: Record<string, string>;
  dependencies: Set<string>;
}

const PACKAGE_EXECUTORS: [string, string][] = [
  ['bun.lock', 'bunx'],
  ['bun.lockb', 'bunx'],
  ['pnpm-lock.yaml', 'pnpm exec'],
  ['yarn.lock', 'yarn'],
];

const PYTHON_RUNNERS: [string, string][] = [
  ['uv.lock', 'uv run pytest'],
  ['poetry.lock', 'poetry run pytest'],
  ['Pipfile.lock', 'pipenv run pytest'],
];

const PYTHON_MANIFESTS = ['pyproject.toml', 'setup.cfg', 'setup.py', 'Pipfile', 'tox.ini'];

const SHELL_OPERATORS = /[;&|<>`$()]/;

const WRAPPERS: Record<string, string> = { c8: 'c8', nyc: 'nyc' };

const VITEST_PROVIDERS = ['@vitest/coverage-v8', '@vitest/coverage-istanbul'];

function quote(path: string) {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function readText(path: string) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function readManifest(path: string): PackageManifest | null {
  const text = readText(join(path, 'package.json'));
  if (text === null) return null;
  try {
    const manifest = JSON.parse(text) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      scripts: manifest.scripts ?? {},
      dependencies: new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ]),
    };
  } catch {
    return null;
  }
}

function resolveExecutor(path: string) {
  return PACKAGE_EXECUTORS.find(([lockfile]) => existsSync(join(path, lockfile)))?.[1] ?? 'npx';
}

function resolveLcovPlan(tool: string, command: string, dir: string): CoveragePlan {
  return { tool, command, report: join(dir, 'lcov.info'), format: 'lcov' };
}

function resolveScriptPlan(script: string, path: string, dir: string): CoveragePlan | null {
  const trimmed = script.trim();
  if (SHELL_OPERATORS.test(trimmed)) return null;
  const [first = '', ...rest] = trimmed.split(/\s+/);
  const args = rest.join(' ');
  const wrapper = WRAPPERS[first];
  if (wrapper) {
    return resolveLcovPlan(
      wrapper,
      `${resolveExecutor(path)} ${wrapper} --reporter=lcov --report-dir=${quote(dir)} ${args}`.trim(),
      dir
    );
  }
  if (first === 'bun' && rest[0] === 'test') {
    const more = rest.slice(1).join(' ');
    return resolveLcovPlan(
      "Bun's test runner",
      `bun test --coverage --coverage-reporter=lcov --coverage-dir=${quote(dir)} ${more}`.trim(),
      dir
    );
  }
  return null;
}

function resolveJavaScriptPlan(path: string, dir: string): CoveragePlan | null {
  const manifest = readManifest(path);
  if (!manifest) return null;
  const script = manifest.scripts.test;
  const fromScript = script ? resolveScriptPlan(script, path, dir) : null;
  if (fromScript) return fromScript;
  const executor = resolveExecutor(path);
  const has = (name: string) => manifest.dependencies.has(name);
  if (has('vitest') && VITEST_PROVIDERS.some(has)) {
    return resolveLcovPlan(
      'Vitest',
      `${executor} vitest run --coverage --coverage.reporter=lcov --coverage.reportsDirectory=${quote(dir)}`,
      dir
    );
  }
  if (has('jest')) {
    return resolveLcovPlan(
      'Jest',
      `${executor} jest --coverage --coverageReporters=lcov --coverageDirectory=${quote(dir)}`,
      dir
    );
  }
  return null;
}

function listRequirementFiles(path: string) {
  return readdirSync(path).filter((name) => /^requirements.*\.txt$/.test(name));
}

function hasPytestCov(path: string) {
  return [...PYTHON_MANIFESTS, ...listRequirementFiles(path)].some((file) =>
    /pytest[-_]cov\b/i.test(readText(join(path, file)) ?? '')
  );
}

function resolvePythonPlan(path: string, dir: string): CoveragePlan | null {
  if (!hasPytestCov(path)) return null;
  const runner =
    PYTHON_RUNNERS.find(([lockfile]) => existsSync(join(path, lockfile)))?.[1] ?? 'python3 -m pytest';
  const report = join(dir, 'coverage.xml');
  return {
    tool: 'pytest-cov',
    command: `${runner} --cov=. --cov-report=xml:${quote(report)}`,
    report,
    format: 'cobertura',
  };
}

function resolveGoPlan(path: string, dir: string): CoveragePlan | null {
  if (!existsSync(join(path, 'go.mod'))) return null;
  const report = join(dir, 'cover.out');
  return { tool: 'go test', command: `go test ./... -coverprofile=${quote(report)}`, report, format: 'go' };
}

export function resolveCoveragePlan(path: string, dir: string) {
  if (!existsSync(path)) return null;
  return resolveJavaScriptPlan(path, dir) ?? resolvePythonPlan(path, dir) ?? resolveGoPlan(path, dir);
}

export function resolveGoModule(path: string) {
  return /^module\s+(\S+)/m.exec(readText(join(path, 'go.mod')) ?? '')?.[1] ?? null;
}
