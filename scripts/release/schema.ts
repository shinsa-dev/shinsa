import { type Redacted, Schema } from 'effect';

export class ScriptUsage extends Schema.TaggedError<ScriptUsage, { readonly brand: unique symbol }>()(
  'ScriptUsage',
  { message: Schema.String }
) {}

export class ChangelogInvalid extends Schema.TaggedError<
  ChangelogInvalid,
  { readonly brand: unique symbol }
>()('ChangelogInvalid', { errors: Schema.Array(Schema.String), message: Schema.String }) {}

export class ReleaseRefused extends Schema.TaggedError<ReleaseRefused, { readonly brand: unique symbol }>()(
  'ReleaseRefused',
  { message: Schema.String }
) {}

export class EngineInvalid extends Schema.TaggedError<EngineInvalid, { readonly brand: unique symbol }>()(
  'EngineInvalid',
  { message: Schema.String }
) {}

export class ArchiveInvalid extends Schema.TaggedError<ArchiveInvalid, { readonly brand: unique symbol }>()(
  'ArchiveInvalid',
  { message: Schema.String }
) {}

export class NpmPublishFailed extends Schema.TaggedError<
  NpmPublishFailed,
  { readonly brand: unique symbol }
>()('NpmPublishFailed', { message: Schema.String }) {}

export class NotaryRejected extends Schema.TaggedError<NotaryRejected, { readonly brand: unique symbol }>()(
  'NotaryRejected',
  { message: Schema.String }
) {}

export class UploadFailed extends Schema.TaggedError<UploadFailed, { readonly brand: unique symbol }>()(
  'UploadFailed',
  { message: Schema.String }
) {}

export const NotarySubmission = Schema.Struct({ id: Schema.String, status: Schema.String });
export type NotarySubmission = typeof NotarySubmission.Type;

export const EngineVersionReport = Schema.Struct({
  command: Schema.optionalKey(Schema.Struct({ version: Schema.optionalKey(Schema.String) })),
});

export interface RetryFailure {
  readonly label: string;
  readonly attempt: number;
  readonly attempts: number;
  readonly delay: number;
  readonly error: { readonly message: string };
}

export interface NotaryCredentials {
  readonly appleId: string;
  readonly password: Redacted.Redacted<string>;
  readonly teamId: string;
}
