import { type Effect, Schema } from 'effect';
import type { AppServices } from '@/lib/runtime/schema.ts';

export const SHARED_TEXT_FAILED = 'The code did not load. Reload the page to try again.';

export const NO_SHARED_CODE = 'This task shares no code.';

export const ONLY_CHANGES = 'Only the files this task changed are shared.';

export class SharedTextFailed extends Schema.TaggedError<
  SharedTextFailed,
  { readonly brand: unique symbol }
>()('SharedTextFailed', { message: Schema.String }) {}

export class SharedCodeRefused extends Schema.TaggedError<
  SharedCodeRefused,
  { readonly brand: unique symbol }
>()('SharedCodeRefused', { message: Schema.String }) {}

export const SharedWholeFiles = Schema.fromJsonString(
  Schema.Struct({ files: Schema.Record(Schema.String, Schema.String) })
);

export const SharedTranscriptText = Schema.fromJsonString(Schema.Array(Schema.Unknown));

export type SharedTextReader = (url: string) => Effect.Effect<string, SharedTextFailed, AppServices>;
