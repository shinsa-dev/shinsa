import { Schema } from 'effect';

export const ENGINE_UNREACHABLE_MESSAGE = 'Couldn’t reach Shinsa.';

export const ENGINE_ANSWER_UNREADABLE_MESSAGE = 'Shinsa sent an answer this page can’t read.';

export const ENGINE_STOPPED_MESSAGE = 'Shinsa stopped answering.';

export const REQUEST_FAILED_CODE = 'request_failed';

export const MACHINE_PARAM = 'machine';

export const LINES_TYPE = 'application/x-ndjson';

export const EngineErrorBody = Schema.Struct({
  error: Schema.Struct({ code: Schema.optionalKey(Schema.String), message: Schema.String }),
});

export class EngineUnreachable extends Schema.TaggedError<
  EngineUnreachable,
  { readonly brand: unique symbol }
>()('EngineUnreachable', { message: Schema.String }) {}

export class EngineRefused extends Schema.TaggedError<EngineRefused, { readonly brand: unique symbol }>()(
  'EngineRefused',
  { status: Schema.Number, code: Schema.String, message: Schema.String }
) {}

export class EngineReadOnly extends Schema.TaggedError<EngineReadOnly, { readonly brand: unique symbol }>()(
  'EngineReadOnly',
  { message: Schema.String }
) {}

export class EngineAnswerInvalid extends Schema.TaggedError<
  EngineAnswerInvalid,
  { readonly brand: unique symbol }
>()('EngineAnswerInvalid', { message: Schema.String }) {}

export class EngineStopped extends Schema.TaggedError<EngineStopped, { readonly brand: unique symbol }>()(
  'EngineStopped',
  { message: Schema.String }
) {}

export type EngineHttpFailure = EngineUnreachable | EngineRefused | EngineReadOnly;

export type EngineFailure = EngineHttpFailure | EngineAnswerInvalid;
