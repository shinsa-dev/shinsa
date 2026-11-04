import { Schema } from 'effect';
import { type CommandResult, NOT_STARTED_EXIT_CODE } from '../../shell/schema.ts';

export class ResourceReadFailed extends Schema.TaggedError<
  ResourceReadFailed,
  { readonly brand: unique symbol }
>()('ResourceReadFailed', { message: Schema.String }) {}

export const COMMAND_MISSING: CommandResult = {
  ok: false,
  code: NOT_STARTED_EXIT_CODE,
  stdout: '',
  stderr: '',
  timedOut: false,
};
