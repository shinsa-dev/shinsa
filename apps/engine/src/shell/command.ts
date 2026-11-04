import { Duration, Effect } from 'effect';
import { resolveCancel } from './abort.ts';
import { describeFailure } from './failure.ts';
import {
  CANCELLED_BEFORE_START,
  CANCELLED_EXIT_CODE,
  COMMAND_TIMEOUT,
  CommandFailed,
  type CommandOptions,
  type CommandResult,
  NOT_STARTED_EXIT_CODE,
} from './schema.ts';
import { Shell } from './service.ts';

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

export const runCommand = Effect.fn('runCommand')(function* (
  command: readonly string[],
  cwd: string,
  options: CommandOptions = {}
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

export const runCommandOrThrow = Effect.fn('runCommandOrThrow')(function* (
  command: readonly string[],
  cwd: string,
  options: CommandOptions = {}
) {
  const result = yield* runCommand(command, cwd, options);
  if (!result.ok) return yield* new CommandFailed({ message: describeFailure(command, result) });
  return result.stdout;
});
