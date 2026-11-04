import type { AgentModel, ProviderLogin } from '@shinsa/core';
import { type Effect, Schema } from 'effect';
import type { ProviderCallFailed } from '../schema.ts';
import type { AgentProvider, ProviderUsageReading } from '../types.ts';

export class NoAgentProvider extends Schema.TaggedError<NoAgentProvider, { readonly brand: unique symbol }>()(
  'NoAgentProvider',
  { message: Schema.String }
) {}

export interface ProviderUsageSource {
  readonly id: string;
  readonly read: Effect.Effect<ProviderUsageReading, ProviderCallFailed>;
}

interface ProviderListing {
  readonly id: string;
  readonly label: string;
  readonly models: AgentModel[];
}

export interface ProvidersShape {
  readonly list: () => readonly AgentProvider[];
  readonly select: (id: string) => AgentProvider | null;
  readonly resolve: (id: string | null | undefined) => Effect.Effect<AgentProvider, NoAgentProvider>;
  readonly listProviders: Effect.Effect<ProviderListing[]>;
  readonly listLogins: Effect.Effect<ProviderLogin[]>;
  readonly listUsageSources: () => ProviderUsageSource[];
}

export const NO_PROVIDER = 'Shinsa has no agent provider.';
