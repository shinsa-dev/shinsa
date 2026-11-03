import { Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { runCommand } from '../shell/index.ts';
import { resolvePrerequisiteReport } from './prerequisites/service.ts';
import {
  type CommandRunner,
  OnboardingCallFailed,
  PREREQUISITE_TIMEOUT_MS,
  type PrerequisiteNeeds,
  type PrerequisiteReport,
} from './schema.ts';

export {
  isBunUsed,
  listMissingInstalls,
  resolveInstallCommand,
  resolveInstallScript,
  resolvePrerequisiteLabel,
} from './prerequisites/catalog.ts';
export type {
  CommandRunner,
  Prerequisite,
  PrerequisiteId,
  PrerequisiteNeeds,
  PrerequisiteReport,
} from './schema.ts';

export function resolvePrerequisites(
  cwd: string,
  run: CommandRunner = runCommand,
  needs: PrerequisiteNeeds = { bun: true }
): Promise<PrerequisiteReport> {
  return edgeRuntime.runPromise(
    resolvePrerequisiteReport({
      run: (command) =>
        Effect.tryPromise({
          try: () => run(command, cwd, { timeoutMs: PREREQUISITE_TIMEOUT_MS }),
          catch: (error) => new OnboardingCallFailed({ message: describeError(error) }),
        }),
      needs,
    })
  );
}
