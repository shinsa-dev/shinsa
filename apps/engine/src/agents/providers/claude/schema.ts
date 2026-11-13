import { Effect, Schema } from 'effect';

const SdkVersion = Schema.String.pipe(
  Schema.catchDecoding(() => Effect.succeedSome('0.0.0')),
  Schema.withDecodingDefaultKey(Effect.succeed('0.0.0'))
);

export const SdkManifestText = Schema.fromJsonString(
  Schema.Struct({ version: SdkVersion, claudeCodeVersion: SdkVersion })
);

export const ConversationLine = Schema.Struct({ type: Schema.Literals(['user', 'assistant']) });

export const SAFE_SESSION_ID = /^[A-Za-z0-9][\w.-]*$/;

export const CHUNK_BYTES = 64 * 1024;

export const SessionContentBlock = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  input: Schema.optional(Schema.Unknown),
  tool_use_id: Schema.optional(Schema.String),
  is_error: Schema.optional(Schema.Boolean),
  content: Schema.optional(Schema.Unknown),
});

export type SessionContentBlock = typeof SessionContentBlock.Type;

export const SessionLine = Schema.Struct({
  type: Schema.optional(Schema.String),
  uuid: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.String),
  isSidechain: Schema.optional(Schema.Boolean),
  isMeta: Schema.optional(Schema.Boolean),
  message: Schema.optional(
    Schema.Struct({
      role: Schema.optional(Schema.String),
      content: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.Unknown)])),
    })
  ),
});

export type SessionLine = typeof SessionLine.Type;

export const SessionLineText = Schema.fromJsonString(SessionLine);
