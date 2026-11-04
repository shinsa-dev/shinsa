import type { CoverageFormat, Repo, Task } from '@shinsa/core';
import { Schema } from 'effect';

export class CoverageReportUnreadable extends Schema.TaggedError<
  CoverageReportUnreadable,
  { readonly brand: unique symbol }
>()('CoverageReportUnreadable', { path: Schema.String, message: Schema.String }) {}

export interface CoverageRun {
  tool: string;
  command: string;
  cwd: string;
  report: string;
  format: CoverageFormat;
}

export interface CoverageRequest {
  repo: Repo;
  task: Task;
  commands: readonly string[];
  baseBranch: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type RunChoice = { runs: CoverageRun[] } | { refusal: string; command: string } | null;

export type RunnerName = 'bun' | 'vitest' | 'jest' | 'pytest' | 'go';

export interface Runner {
  tool: string;
  prefixes: string[];
  convert: (prefix: string, args: string[], dir: string) => { command: string; report: string } | null;
  format: CoverageFormat;
}

export interface Invocation {
  cwd: string;
  prefix: string;
  name: RunnerName;
  args: string[];
}

export const COVERAGE_DIR_PREFIX = 'shinsa-coverage-';

export const NO_BASE_COMMIT = 'Shinsa could not find the commit the task’s branch started from.';

export const JS_PREFIXES = ['', 'bunx', 'npx', 'pnpm exec', 'pnpm', 'yarn'];

export const PY_PREFIXES = ['', 'python -m', 'python3 -m', 'uv run', 'poetry run', 'pipenv run'];

export const SHELL_OPERATORS = /[;&|<>`$()]/;

export const CD_PREFIX = /^cd\s+(\S+)\s*&&\s*(.+)$/;

export const CWD_OPTION = /^--cwd(?:=(.+))?$/;

export const PYTHON_MANIFESTS = ['pyproject.toml', 'setup.cfg', 'setup.py', 'Pipfile', 'tox.ini'];

export const VITEST_PROVIDERS = ['@vitest/coverage-v8', '@vitest/coverage-istanbul'];
