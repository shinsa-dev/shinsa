import { CLAUDE_PROVIDER } from '@shinsa/core';
import { log } from '../../log/index.ts';
import { createClaudeProvider, type EunoeLink } from './claude/index.ts';
import { CLAUDE_RUNTIME } from './claude/sdk.ts';
import { createCodexProvider } from './codex/index.ts';
import type { AgentProvider, ProviderUsageReading } from './types.ts';

export interface ProviderUsageSource {
  id: string;
  read: () => Promise<ProviderUsageReading>;
}

export {
  type AgentProvider,
  type AgentSession,
  type AgentSessionInput,
  type AgentSessionResult,
  type CompletionRequest,
  type JsonSchema,
  type ModelSource,
  type ProviderUsageReading,
  resolveCapabilities,
  resolveSessionOptions,
  type SessionArtifactStatus,
  type SessionContext,
  type SessionStarter,
  type StructuredRequest,
} from './types.ts';

export function listDefaultProviders(eunoe: EunoeLink | null = null): AgentProvider[] {
  return [createClaudeProvider(CLAUDE_RUNTIME, { eunoe }), createCodexProvider()];
}

export class ProviderRegistry {
  readonly #providers = new Map<string, AgentProvider>();

  constructor(providers: AgentProvider[] = listDefaultProviders()) {
    for (const provider of providers) this.#providers.set(provider.id, provider);
  }

  list() {
    return [...this.#providers.values()];
  }

  listProviders() {
    return Promise.all(
      this.list().map(async (provider) => ({
        id: provider.id,
        label: provider.label,
        models: await provider.listModels(),
      }))
    );
  }

  listLogins() {
    return Promise.all(this.list().flatMap((provider) => (provider.readLogin ? [provider.readLogin()] : [])));
  }

  listUsageSources(): ProviderUsageSource[] {
    return this.list().flatMap((provider) => {
      const read = provider.readUsage;
      return read ? [{ id: provider.id, read: () => read() }] : [];
    });
  }

  select(id: string): AgentProvider | null {
    return this.#providers.get(id) ?? null;
  }

  resolve(id: string | null | undefined): AgentProvider {
    const provider = this.#providers.get(id ?? CLAUDE_PROVIDER);
    if (provider) return provider;
    const fallback = this.#providers.get(CLAUDE_PROVIDER) ?? this.list()[0];
    if (!fallback) throw new Error('Shinsa has no agent provider.');
    log.warn('[Providers] Unknown provider; using the default', { provider: id, fallback: fallback.id });
    return fallback;
  }
}
