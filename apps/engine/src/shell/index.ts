import { Duration, Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { resolveCancel } from './abort.ts';
import { describeFailure } from './failure.ts';
import { stopProcessGroup } from './processes.ts';
import {
  CANCELLED_BEFORE_START,
  CANCELLED_EXIT_CODE,
  COMMAND_TIMEOUT,
  CommandFailed,
  type CommandEnv,
  type CommandResult,
  NOT_STARTED_EXIT_CODE,
} from './schema.ts';
import { Shell } from './service.ts';

export { describeFailure } from './failure.ts';
export { listDescendants } from './processes.ts';
export type { CommandResult } from './schema.ts';

export interface CommandOptions {
  input?: string;
  env?: CommandEnv;
  timeoutMs?: number | null;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
  onSpawn?: (pid: number) => void;
}

function resolveTimeout(timeoutMs: number | null | undefined) {
  if (timeoutMs === undefined) return COMMAND_TIMEOUT;
  return timeoutMs === null ? null : Duration.millis(timeoutMs);
}

const notStarted = (stderr: string, code = NOT_STARTED_EXIT_CODE): CommandResult => ({
  ok: false,
  code,
  stdout: '',
  stderr,
  timedOut: false,
});

const runEdgeCommand = Effect.fn('runCommand')(function* (
  command: string[],
  cwd: string,
  options: CommandOptions
) {
  const { signal, onLine, onSpawn } = options;
  if (signal?.aborted) return notStarted(CANCELLED_BEFORE_START, CANCELLED_EXIT_CODE);
  const [program, ...args] = command;
  if (program === undefined) return notStarted('No command was given.');
  const shell = yield* Shell;
  return yield* shell
    .run({
      argv: [program, ...args],
      cwd,
      input: options.input,
      env: options.env,
      timeout: resolveTimeout(options.timeoutMs),
      cancel: resolveCancel(signal),
      onLine: onLine ? (line) => Effect.sync(() => onLine(line)) : undefined,
      onSpawn: onSpawn ? (pid) => Effect.sync(() => onSpawn(pid)) : undefined,
    })
    .pipe(Effect.catchTag('CommandNotFound', (missing) => Effect.succeed(notStarted(missing.message))));
});

export function runCommand(command: string[], cwd: string, options: CommandOptions = {}) {
  return edgeRuntime.runPromise(runEdgeCommand(command, cwd, options));
}

export function runCommandOrThrow(command: string[], cwd: string, options: CommandOptions = {}) {
  return edgeRuntime.runPromise(
    Effect.flatMap(runEdgeCommand(command, cwd, options), (result) =>
      result.ok
        ? Effect.succeed(result.stdout)
        : Effect.fail(new CommandFailed({ message: describeFailure(command, result) }))
    )
  );
}

export function killProcessGroup(pid: number) {
  edgeRuntime.runSync(stopProcessGroup(pid));
}

export function killProcessTree(pid: number) {
  return edgeRuntime.runPromise(Shell.use((shell) => shell.stopTree(pid)));
}
