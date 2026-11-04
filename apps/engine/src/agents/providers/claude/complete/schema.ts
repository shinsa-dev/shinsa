import { Schema } from 'effect';

export class ClaudeCallFailed extends Schema.TaggedError<
  ClaudeCallFailed,
  { readonly brand: unique symbol }
>()('ClaudeCallFailed', { message: Schema.String }) {}

export class ClaudeTimedOut extends Schema.TaggedError<ClaudeTimedOut, { readonly brand: unique symbol }>()(
  'ClaudeTimedOut',
  { message: Schema.String }
) {}

export const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';
