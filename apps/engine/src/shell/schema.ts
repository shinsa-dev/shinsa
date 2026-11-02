import { Duration, type Effect, Schema } from 'effect';

export const CommandResult = Schema.Struct({
  ok: Schema.Boolean,
  code: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
  timedOut: Schema.Boolean,
});
export type CommandResult = typeof CommandResult.Type;

export class CommandNotFound extends Schema.TaggedError<CommandNotFound, { readonly brand: unique symbol }>()(
  'CommandNotFound',
  { command: Schema.String, message: Schema.String }
) {}

export class CommandFailed extends Schema.TaggedError<CommandFailed, { readonly brand: unique symbol }>()(
  'CommandFailed',
  { message: Schema.String }
) {}

export class SignalRefused extends Schema.TaggedError<SignalRefused, { readonly brand: unique symbol }>()(
  'SignalRefused',
  { code: Schema.NullOr(Schema.String), message: Schema.String }
) {}

export type Argv = readonly [string, ...string[]];

export type CommandEnv = Record<string, string | undefined>;

export interface CommandRequest {
  readonly argv: Argv;
  readonly cwd: string;
  readonly input?: string | undefined;
  readonly env?: CommandEnv | undefined;
  readonly timeout: Duration.Duration | null;
  readonly cancel?: Effect.Effect<void> | undefined;
  readonly onLine?: ((line: string) => Effect.Effect<void>) | undefined;
  readonly onSpawn?: ((pid: number) => Effect.Effect<void>) | undefined;
}

export type StopReason = 'timeout' | 'cancel';

export const COMMAND_TIMEOUT = Duration.minutes(10);

export const PROCESS_TABLE_TIMEOUT = Duration.seconds(5);

export const PROCESS_TABLE_COMMAND: Argv = ['ps', '-A', '-o', 'pid=,ppid='];

export const QUIET_ENV: CommandEnv = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GH_PROMPT_DISABLED: '1',
};

export const NOT_STARTED_EXIT_CODE = 127;

export const CANCELLED_EXIT_CODE = 130;

export const KILLED_EXIT_CODE = 137;

export const GROUP_LEFT_RUNNING_SIGNAL = 'SIGCONT';

export const CANCELLED_BEFORE_START = 'The command was cancelled before it started.';

export const SystemError = Schema.Struct({ code: Schema.String });

export const NO_SUCH_PROCESS = 'ESRCH';

export const NOT_PERMITTED = 'EPERM';
