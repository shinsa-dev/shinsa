import { Effect, Schema } from 'effect';

const SdkVersion = Schema.String.pipe(
  Schema.catchDecoding(() => Effect.succeedSome('0.0.0')),
  Schema.withDecodingDefaultKey(Effect.succeed('0.0.0'))
);

export const SdkManifestText = Schema.fromJsonString(
  Schema.Struct({ version: SdkVersion, claudeCodeVersion: SdkVersion })
);
