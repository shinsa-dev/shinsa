import { type Redacted, Schema } from 'effect';
import { DMG_NAME } from '../../apps/marketing/src/worker/releases/schema.ts';
import { ZIP_NAME } from '../../apps/marketing/src/worker/updates/schema.ts';

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

export class ActionsFileFailed extends Schema.TaggedError<
  ActionsFileFailed,
  { readonly brand: unique symbol }
>()('ActionsFileFailed', { message: Schema.String }) {}

export const ReleaseChannel = Schema.Literals(['stable', 'beta', 'canary']);
export type ReleaseChannel = typeof ReleaseChannel.Type;

export const ReleaseBump = Schema.Literals(['patch', 'minor', 'major']);
export type ReleaseBump = typeof ReleaseBump.Type;

export const ReleaseView = Schema.Struct({
  tagName: Schema.String,
  isDraft: Schema.optionalKey(Schema.Unknown),
  isPrerelease: Schema.optionalKey(Schema.Unknown),
  publishedAt: Schema.optionalKey(Schema.Unknown),
  assets: Schema.optionalKey(Schema.Unknown),
});

export const ReleaseAssets = Schema.Array(Schema.Unknown);

export const DmgAsset = Schema.Struct({
  name: Schema.Literal(DMG_NAME),
  size: Schema.optionalKey(Schema.Unknown),
  digest: Schema.optionalKey(Schema.Unknown),
});

export const AssetDigest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));

export const TokenAnswer = Schema.Struct({
  success: Schema.Literal(true),
  result: Schema.Struct({ id: Schema.String }),
});

export const UpdateFile = Schema.Struct({
  version: Schema.String,
  files: Schema.Array(Schema.Unknown),
  releaseDate: Schema.String,
});

export const ZipEntryName = Schema.Struct({ url: Schema.Literal(ZIP_NAME) });

export const ZipEntry = Schema.Struct({
  sha512: Schema.String,
  size: Schema.Int.check(Schema.isGreaterThan(0)),
});

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
