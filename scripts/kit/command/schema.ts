import { Schema } from 'effect';

export class CommandFailed extends Schema.TaggedError<CommandFailed, { readonly brand: unique symbol }>()(
  'CommandFailed',
  { command: Schema.String, code: Schema.Number, stderr: Schema.String, message: Schema.String }
) {}

export const CommandOutput = Schema.Struct({
  code: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
});
export type CommandOutput = typeof CommandOutput.Type;

export type CommandArgv = readonly [string, ...string[]];

export interface CommandOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}
