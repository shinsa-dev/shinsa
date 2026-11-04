import type { AgentModel } from '@shinsa/core';
import { type Duration, type Effect, Schema } from 'effect';
import type { ClaudeRuntime } from '../sdk/schema.ts';

export class ModelsUnavailable extends Schema.TaggedError<
  ModelsUnavailable,
  { readonly brand: unique symbol }
>()('ModelsUnavailable', { message: Schema.String }) {}

export interface ModelCatalogDefinition {
  readonly runtime: ClaudeRuntime;
  readonly timeout: Duration.Duration;
}

export interface ModelCatalogHandle {
  readonly list: Effect.Effect<AgentModel[]>;
}

export const CATALOG_TIMEOUT_MS = 20_000;
