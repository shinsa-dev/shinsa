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
