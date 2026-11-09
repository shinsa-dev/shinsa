import { Schema } from 'effect';

export const ProcessResult = Schema.Struct({
  ok: Schema.Boolean,
  stdout: Schema.String,
  stderr: Schema.String,
});

export type ProcessResult = typeof ProcessResult.Type;
