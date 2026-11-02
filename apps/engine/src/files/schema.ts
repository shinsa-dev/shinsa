import { Effect, Predicate, Schema, SchemaTransformation } from 'effect';
import { identity } from 'effect/Function';

export class JsonFileUnreadable extends Schema.TaggedError<
  JsonFileUnreadable,
  { readonly brand: unique symbol }
>()('JsonFileUnreadable', { path: Schema.String, reason: Schema.String }) {}

export class JsonFileWriteFailed extends Schema.TaggedError<
  JsonFileWriteFailed,
  { readonly brand: unique symbol }
>()('JsonFileWriteFailed', { path: Schema.String, message: Schema.String }) {}

export const JsonText = Schema.fromJsonString(Schema.Unknown);

export const JSON_FILE_MODE = 0o600;

export const JSON_INDENT = 2;

const TextEntries = Schema.Record(
  Schema.String,
  Schema.String.pipe(Schema.catchDecoding(() => Effect.succeedNone))
);

export const TextList = Schema.Array(Schema.Unknown).pipe(
  Schema.decodeTo(
    Schema.Array(Schema.String),
    SchemaTransformation.transform({
      decode: (items): readonly string[] => items.filter(Predicate.isString),
      encode: identity,
    })
  )
);

const WorkspacePackages = Schema.Struct({
  packages: Schema.optionalKey(TextList.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
});

export const PackageManifest = Schema.Struct({
  name: Schema.optionalKey(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  packageManager: Schema.optionalKey(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  scripts: Schema.optionalKey(TextEntries.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  dependencies: Schema.optionalKey(TextEntries.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  devDependencies: Schema.optionalKey(TextEntries.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  workspaces: Schema.optionalKey(
    Schema.Union([TextList, WorkspacePackages]).pipe(Schema.catchDecoding(() => Effect.succeedNone))
  ),
});
export type PackageManifest = typeof PackageManifest.Type;

export const PackageManifestText = Schema.fromJsonString(PackageManifest);

export const PACKAGE_MANIFEST = 'package.json';

const DenoManifest = Schema.Struct({
  tasks: Schema.optionalKey(TextEntries.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
});

export const DenoManifestText = Schema.fromJsonString(DenoManifest);
