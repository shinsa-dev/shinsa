import { Duration, Effect, Schema } from 'effect';

export const StoredRef = Schema.Struct({
  value: Schema.String,
  taskId: Schema.String,
  savedAt: Schema.Number,
});
export type StoredRef = typeof StoredRef.Type;

export const StoredHook = Schema.Struct({
  token: Schema.String,
  secret: Schema.optionalKey(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
});

export interface WebhookCredentials {
  token: string;
  secret: string | null;
}

export const McpCredentials = Schema.Record(Schema.String, Schema.Unknown);
export type McpCredentials = Record<string, unknown>;

export const SecretFileFields = Schema.Struct({
  salt: Schema.NonEmptyString,
  refs: Schema.optionalKey(
    Schema.Record(Schema.String, StoredRef.pipe(Schema.catchDecoding(() => Effect.succeedNone))).pipe(
      Schema.catchDecoding(() => Effect.succeedSome({}))
    )
  ),
  hooks: Schema.optionalKey(
    Schema.Record(Schema.String, StoredHook.pipe(Schema.catchDecoding(() => Effect.succeedNone))).pipe(
      Schema.catchDecoding(() => Effect.succeedSome({}))
    )
  ),
  mcp: Schema.optionalKey(
    Schema.Record(Schema.String, McpCredentials.pipe(Schema.catchDecoding(() => Effect.succeedNone))).pipe(
      Schema.catchDecoding(() => Effect.succeedSome({}))
    )
  ),
});

export interface SecretFile {
  version: 1;
  salt: string;
  refs: Record<string, StoredRef>;
  hooks: Record<string, WebhookCredentials>;
  mcp: Record<string, McpCredentials>;
}

export const NO_SALT = 'It has no salt.';

export const SALT_BYTES = 32;

export const HOOK_TOKEN_BYTES = 24;

export const REF_PREFIX = 'secret-ref:';

export const REF_LENGTH = 32;

export const SECRET_REF_TTL = Duration.days(1);

export const SECRET_REF_TTL_MS = Duration.toMillis(SECRET_REF_TTL);
