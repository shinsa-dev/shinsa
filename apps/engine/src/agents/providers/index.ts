import { edgeRuntime } from '../../runtime/edge.ts';
import { createClaudeProvider, type EunoeLink } from './claude/index.ts';
import { CLAUDE_RUNTIME } from './claude/sdk.ts';
import { createCodexProvider } from './codex/index.ts';
import type { ProvidersShape } from './registry/schema.ts';
import { Providers } from './registry/service.ts';
import type { AgentProvider } from './types.ts';

export type { ProviderUsageSource } from './registry/schema.ts';
export { Providers } from './registry/service.ts';
export { acquireAgentSession } from './session/service.ts';

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
  readonly #providers: ProvidersShape;

  constructor(providers: AgentProvider[] = listDefaultProviders()) {
    this.#providers = Providers.make(providers);
  }

  get service() {
    return this.#providers;
  }

  list() {
    return [...this.#providers.list()];
  }

  listProviders() {
    return edgeRuntime.runPromise(this.#providers.listProviders);
  }

  listLogins() {
    return edgeRuntime.runPromise(this.#providers.listLogins);
  }

  listUsageSources() {
    return this.#providers.listUsageSources();
  }

  select(id: string): AgentProvider | null {
    return this.#providers.select(id);
  }

  resolve(id: string | null | undefined): AgentProvider {
    return edgeRuntime.runSync(this.#providers.resolve(id));
  }
}
