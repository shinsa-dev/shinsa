import { Schema } from 'effect';

export class EngineBuildFailed extends Schema.TaggedError<
  EngineBuildFailed,
  { readonly brand: unique symbol }
>()('EngineBuildFailed', { message: Schema.String }) {}

export class EunoeUnavailable extends Schema.TaggedError<
  EunoeUnavailable,
  { readonly brand: unique symbol }
>()('EunoeUnavailable', { message: Schema.String }) {}

export const SdkPackage = Schema.Struct({ version: Schema.String, claudeCodeVersion: Schema.String });

export const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
