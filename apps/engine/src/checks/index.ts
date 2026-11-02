import type { CheckToRun } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import { CheckRunner } from './runner/service.ts';
import type { CheckOptions, CheckRoundOptions, CheckRun } from './schema.ts';

export { resolveInstallCommand } from './install.ts';
export { listFailedFiles, tailOutput } from './output.ts';
export { CHECK_TIMEOUT_MS } from './schema.ts';
export type { BaseComparison, CheckOptions, CheckRoundOptions, CheckRun } from './schema.ts';

export function runCheck(check: CheckToRun, cwd: string, options: CheckOptions): Promise<CheckRun> {
  return edgeRuntime.runPromise(CheckRunner.use((runner) => runner.run(check, cwd, options)));
}

export function confirmFailure(run: CheckRun, cwd: string, options: CheckOptions): Promise<CheckRun> {
  return edgeRuntime.runPromise(CheckRunner.use((runner) => runner.confirm(run, cwd, options)));
}

export function runChecks(checks: readonly CheckToRun[], cwd: string, options: CheckRoundOptions) {
  return edgeRuntime.runPromise(CheckRunner.use((runner) => runner.runAll(checks, cwd, options)));
}
