import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CoverageDetection, CoverageFormat } from '@shinsa/core';

export interface CoverageRun {
  tool: string;
  command: string;
  cwd: string;
  report: string;
  format: CoverageFormat;
}

type RunnerName = 'bun' | 'vitest' | 'jest' | 'pytest' | 'go';

interface Runner {
  tool: string;
  prefixes: string[];
  convert: (prefix: string, args: string[], dir: string) => { command: string; report: string } | null;
  format: CoverageFormat;
}

const JS_PREFIXES = ['', 'bunx', 'npx', 'pnpm exec', 'pnpm', 'yarn'];

const PY_PREFIXES = ['', 'python -m', 'python3 -m', 'uv run', 'poetry run', 'pipenv run'];

const SHELL_OPERATORS = /[;&|<>`$()]/;

const CD_PREFIX = /^cd\s+(\S+)\s*&&\s*(.+)$/;

const CWD_OPTION = /^--cwd(?:=(.+))?$/;

const PYTHON_MANIFESTS = ['pyproject.toml', 'setup.cfg', 'setup.py', 'Pipfile', 'tox.ini'];

const VITEST_PROVIDERS = ['@vitest/coverage-v8', '@vitest/coverage-istanbul'];

function quote(path: string) {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function joinCommand(parts: readonly string[]) {
  return parts.filter((part) => part.length > 0).join(' ');
}

const RUNNERS: Record<RunnerName, Runner> = {
  bun: {
    tool: "Bun's test runner",
    prefixes: [''],
    format: 'lcov',
    convert: (_prefix, args, dir) => {
      if (args[0] !== 'test') return null;
      const options = `--coverage --coverage-reporter=lcov --coverage-dir=${quote(dir)}`;
      return {
        command: joinCommand(['bun test', options, ...args.slice(1)]),
        report: join(dir, 'lcov.info'),
      };
    },
  },
  vitest: {
    tool: 'Vitest',
    prefixes: JS_PREFIXES,
    format: 'lcov',
    convert: (prefix, args, dir) => {
      const rest = args[0] === 'run' ? args.slice(1) : args;
      const options = `--coverage.enabled=true --coverage.reporter=lcov --coverage.reportsDirectory=${quote(dir)}`;
      return {
        command: joinCommand([prefix, 'vitest run', options, ...rest]),
        report: join(dir, 'lcov.info'),
      };
    },
  },
  jest: {
    tool: 'Jest',
    prefixes: JS_PREFIXES,
    format: 'lcov',
    convert: (prefix, args, dir) => {
      const options = `--coverage --coverageReporters=lcov --coverageDirectory=${quote(dir)}`;
      return { command: joinCommand([prefix, 'jest', options, ...args]), report: join(dir, 'lcov.info') };
    },
  },
  pytest: {
    tool: 'pytest-cov',
    prefixes: PY_PREFIXES,
    format: 'cobertura',
    convert: (prefix, args, dir) => {
      const report = join(dir, 'coverage.xml');
      const options = `--cov=. --cov-report=xml:${quote(report)}`;
      return { command: joinCommand([prefix, 'pytest', options, ...args]), report };
    },
  },
  go: {
    tool: 'go test',
    prefixes: [''],
    format: 'go',
    convert: (_prefix, args, dir) => {
      if (args[0] !== 'test') return null;
      const report = join(dir, 'cover.out');
      return {
        command: joinCommand(['go test', `-coverprofile=${quote(report)}`, ...args.slice(1)]),
        report,
      };
    },
  },
};

interface Invocation {
  cwd: string;
  prefix: string;
  name: RunnerName;
  args: string[];
}

function readCwdOption(args: readonly string[], cwd: string) {
  const index = args.findIndex((arg) => CWD_OPTION.test(arg));
  if (index < 0) return cwd;
  const folder = CWD_OPTION.exec(args[index] ?? '')?.[1] ?? args[index + 1] ?? '.';
  return join(cwd, folder);
}

function readInvocation(tokens: string[], cwd: string): Invocation | null {
  if (tokens[0] === 'bun')
    return { cwd: readCwdOption(tokens, cwd), prefix: '', name: 'bun', args: tokens.slice(1) };
  for (const name of ['vitest', 'jest', 'pytest', 'go'] as const) {
    const index = tokens.indexOf(name);
    const prefix = tokens.slice(0, Math.max(0, index)).join(' ');
    if (index >= 0 && RUNNERS[name].prefixes.includes(prefix)) {
      return { cwd, prefix, name, args: tokens.slice(index + 1) };
    }
  }
  return null;
}

export function resolveCoverageRun(command: string, worktree: string, dir: string): CoverageRun | null {
  const trimmed = command.trim();
  const cd = CD_PREFIX.exec(trimmed);
  const body = cd?.[2] ?? trimmed;
  if (SHELL_OPERATORS.test(body)) return null;
  const invocation = readInvocation(body.split(/\s+/), cd ? join(worktree, cd[1] ?? '.') : worktree);
  if (!invocation) return null;
  const runner = RUNNERS[invocation.name];
  const converted = runner.convert(invocation.prefix, invocation.args, dir);
  if (!converted) return null;
  return {
    tool: runner.tool,
    command: cd ? `cd ${cd[1]} && ${converted.command}` : converted.command,
    cwd: invocation.cwd,
    report: converted.report,
    format: runner.format,
  };
}

function readText(path: string) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function readManifest(path: string) {
  try {
    const manifest = JSON.parse(readText(join(path, 'package.json')) ?? 'null') as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    } | null;
    if (!manifest) return null;
    const names = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    return { test: manifest.scripts?.test ?? '', dependencies: new Set(names) };
  } catch {
    return null;
  }
}

function resolveJavaScriptTool(path: string) {
  const manifest = readManifest(path);
  if (!manifest) return null;
  const has = (name: string) => manifest.dependencies.has(name);
  if (has('vitest') && VITEST_PROVIDERS.some(has)) return RUNNERS.vitest.tool;
  if (has('jest')) return RUNNERS.jest.tool;
  if (/^bun test\b/.test(manifest.test.trim())) return RUNNERS.bun.tool;
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

function resolveTool(path: string) {
  if (!existsSync(path)) return null;
  const javascript = resolveJavaScriptTool(path);
  if (javascript) return javascript;
  if (hasPytestCov(path)) return RUNNERS.pytest.tool;
  return existsSync(join(path, 'go.mod')) ? RUNNERS.go.tool : null;
}

export function resolveCoverageDetection(path: string): CoverageDetection | null {
  const tool = resolveTool(path);
  if (!tool) return null;
  return { tool, command: `The test checks of each task, run once more with ${tool}'s coverage report.` };
}

export function resolveGoModule(path: string) {
  return /^module\s+(\S+)/m.exec(readText(join(path, 'go.mod')) ?? '')?.[1] ?? null;
}
