import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CoverageDetection } from '@shinsa/core';
import { listDependencyNames, readPackageManifest } from '../files/manifest.ts';
import {
  CD_PREFIX,
  type CoverageRun,
  CWD_OPTION,
  type Invocation,
  JS_PREFIXES,
  PY_PREFIXES,
  PYTHON_MANIFESTS,
  type Runner,
  type RunnerName,
  SHELL_OPERATORS,
  VITEST_PROVIDERS,
} from './schema.ts';

export type { CoverageRun } from './schema.ts';

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

function resolveJavaScriptTool(path: string) {
  const manifest = readPackageManifest(path);
  if (!manifest) return null;
  const dependencies = new Set(listDependencyNames(manifest));
  const has = (name: string) => dependencies.has(name);
  if (has('vitest') && VITEST_PROVIDERS.some(has)) return RUNNERS.vitest.tool;
  if (has('jest')) return RUNNERS.jest.tool;
  if (/^bun test\b/.test((manifest.scripts?.test ?? '').trim())) return RUNNERS.bun.tool;
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
