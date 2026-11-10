import { Schema } from 'effect';

export const ENGINE_TARGETS = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-x64',
  'bun-linux-arm64',
] as const;

export type EngineTarget = (typeof ENGINE_TARGETS)[number];

export const APP_ENGINE_TARGET: EngineTarget = 'bun-darwin-arm64';

export class EngineTargetUnknown extends Schema.TaggedError<
  EngineTargetUnknown,
  { readonly brand: unique symbol }
>()('EngineTargetUnknown', { target: Schema.String, message: Schema.String }) {}
