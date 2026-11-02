import type { Repo, ReportCheck } from '@shinsa/core';
import { Duration, type Effect } from 'effect';
import type { GitFailed } from '../git/schema.ts';

export type TestRunner = 'bun' | 'vitest' | 'jest';

export interface FailedTestGroup {
  runner: TestRunner;
  packageDir: string;
  files: string[];
}

export type FailedTests =
  | { kind: 'none' }
  | { kind: 'clean' }
  | { kind: 'unknown' }
  | { kind: 'files'; groups: FailedTestGroup[] };

export interface FailedTestCase {
  file: string;
  test: string;
}

export type FailureKind = 'test' | 'type' | 'lint' | 'error';

export interface CheckFailure {
  kind: FailureKind;
  file: string;
  key: string;
  label: string;
}

export interface FailureDiff {
  added: CheckFailure[];
  known: CheckFailure[];
}

export interface CheckRun {
  check: ReportCheck;
  output: string;
  timedOut: boolean;
  failedFiles: string[] | null;
  failures: CheckFailure[] | null;
}

export interface CheckOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
  onSpawn?: (pid: number) => void;
}

export type BaseComparison = (run: CheckRun) => Promise<FailureDiff | null>;

export interface CheckRoundOptions extends CheckOptions {
  compare?: BaseComparison;
}

export interface BaseRequest extends CheckOptions {
  repo: Repo;
  resolveBase: () => Promise<string | null>;
  cwd: string;
  run: CheckRun;
}

export interface BaseResult {
  failed: boolean;
  failures: CheckFailure[] | null;
}

export interface BaseCheckout {
  key: string;
  repo: Repo;
  path: string;
  ready: Effect.Effect<string, GitFailed>;
  users: number;
}

export interface BaseCheckoutPool {
  readonly compare: (request: BaseRequest) => Effect.Effect<FailureDiff | null>;
}

export interface GroupRerun {
  group: FailedTestGroup;
  passed: boolean;
  output: string;
}

const CHECK_TIMEOUT = Duration.minutes(15);

export const CHECK_TIMEOUT_MS = Duration.toMillis(CHECK_TIMEOUT);

export const OUTPUT_TAIL = 4000;

export const SIGNAL = /(error|fail|✗|expected|received|panic|exception|\(fail\))/i;

export const SIGNAL_LINES = 60;

export const CHECK_ENV = { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };

export const LOW_PRIORITY = ['nice', '-n', '10'];

export const COVERAGE_FLOOR_ONLY =
  'Every test passed. Only the coverage floor failed, which a scoped run cannot meet: CI checks it on the whole suite.';

export const NO_TESTS =
  /did not match any test files|had no matches|No test files found|No tests found|no tests ran|no test files/i;

export const KEPT_CHECKOUTS = 3;

export const UNUSED_CACHE = Duration.days(14);

export const PACKAGE_MANAGERS: { lockfiles: string[]; install: string[] | null }[] = [
  { lockfiles: ['bun.lock', 'bun.lockb'], install: ['bun', 'install'] },
  { lockfiles: ['pnpm-lock.yaml'], install: ['pnpm', 'install', '--frozen-lockfile'] },
  { lockfiles: ['yarn.lock'], install: null },
  { lockfiles: ['package-lock.json'], install: ['npm', 'ci'] },
];

export const CACHES_DIR = 'caches';

export const TURBO_CACHE = 'turbo';

export const TURBO_CONFIG = 'turbo.json';
