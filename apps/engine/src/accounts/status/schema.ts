import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { CommandOptions, CommandResult } from '../../shell/index.ts';

export type ClaudeRunner = (
  command: string[],
  cwd: string,
  options: CommandOptions
) => Promise<CommandResult>;

export class ClaudeCommandFailed extends Schema.TaggedError<
  ClaudeCommandFailed,
  { readonly brand: unique symbol }
>()('ClaudeCommandFailed', {
  message: Schema.String,
}) {}

export type ClaudeCommand<E> = (
  command: string[],
  cwd: string,
  options: CommandOptions
) => Effect.Effect<CommandResult, E>;
