import { type AgentProviderInfo, KNOWN_AGENT_PROVIDERS } from '@shinsa/core';
import type { FieldFailure } from '@shinsa/core/engine-api/schema';

export const RESTART_UNSUPPORTED: FieldFailure = {
  code: 'restart_unsupported',
  message: 'This Shinsa cannot restart its engine.',
};

export const KNOWN_PROVIDERS: readonly AgentProviderInfo[] = KNOWN_AGENT_PROVIDERS;
