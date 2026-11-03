import type { AgentModel } from '@shinsa/core';
import { Duration, type Effect } from 'effect';
import type { CodexExecutable } from '../executable/schema.ts';

export const CATALOG_TIMEOUT_MS = 20_000;

export const MAX_PAGES = 10;

export interface CodexModelsDefinition {
  readonly executable: Effect.Effect<CodexExecutable>;
  readonly env: Record<string, string | undefined> | undefined;
  readonly cwd: string;
  readonly timeout: Duration.Duration;
}

export interface CodexModelCatalogHandle {
  readonly list: Effect.Effect<AgentModel[]>;
}

export const NO_MODELS = 'Codex reported no models.';
