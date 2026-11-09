import { join } from 'node:path';
import type { CoverageDetection } from '@shinsa/core';
import { Effect, Option } from 'effect';
import { listDependencyNames, selectPackageManifest } from '../files/manifest.ts';
import { isPresent, listEntries, selectText } from '../files/probe.ts';
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

const resolveJavaScriptTool = Effect.fn('CoverageDetection.resolveJavaScriptTool')(function* (path: string) {
  const manifest = yield* selectPackageManifest(path);
  if (Option.isNone(manifest)) return null;
  const dependencies = new Set(listDependencyNames(manifest.value));
  const has = (name: string) => dependencies.has(name);
  if (has('vitest') && VITEST_PROVIDERS.some(has)) return RUNNERS.vitest.tool;
  if (has('jest')) return RUNNERS.jest.tool;
  if (/^bun test\b/.test((manifest.value.scripts?.test ?? '').trim())) return RUNNERS.bun.tool;
  return null;
});

const hasPytestCov = Effect.fn('CoverageDetection.hasPytestCov')(function* (path: string) {
  const requirements = (yield* listEntries(path)).filter((name) => /^requirements.*\.txt$/.test(name));
  for (const file of [...PYTHON_MANIFESTS, ...requirements]) {
    const text = yield* selectText(join(path, file));
    if (Option.isSome(text) && /pytest[-_]cov\b/i.test(text.value)) return true;
  }
  return false;
});

const resolveTool = Effect.fn('CoverageDetection.resolveTool')(function* (path: string) {
  if (!(yield* isPresent(path))) return null;
  const javascript = yield* resolveJavaScriptTool(path);
  if (javascript) return javascript;
  if (yield* hasPytestCov(path)) return RUNNERS.pytest.tool;
  return (yield* isPresent(join(path, 'go.mod'))) ? RUNNERS.go.tool : null;
});

export const selectCoverageDetection = Effect.fn('CoverageDetection.select')(function* (path: string) {
  const tool = yield* resolveTool(path);
  if (!tool) return Option.none<CoverageDetection>();
  return Option.some<CoverageDetection>({
    tool,
    command: `The test checks of each task, run once more with ${tool}'s coverage report.`,
  });
});

export const selectGoModule = Effect.fn('CoverageDetection.selectGoModule')(function* (path: string) {
  const text = yield* selectText(join(path, 'go.mod'));
  return Option.flatMap(text, (each) => Option.fromNullishOr(/^module\s+(\S+)/m.exec(each)?.[1]));
});
