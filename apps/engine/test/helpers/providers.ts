import type { AgentModel, ProviderLogin } from '@shinsa/core';
import { Effect, Exit, Layer, ManagedRuntime, Scope } from 'effect';
import {
  ClaudeProviderOptions,
  type ClaudeProviderSettings,
} from '../../src/agents/providers/claude/provider/schema.ts';
import { ClaudeProvider } from '../../src/agents/providers/claude/provider/service.ts';
import type { ClaudeRuntime } from '../../src/agents/providers/claude/sdk/schema.ts';
import { ClaudeSdk } from '../../src/agents/providers/claude/sdk/service.ts';
import type { ClaudeSessionOptions } from '../../src/agents/providers/claude/session/schema.ts';
import { makeClaudeSession } from '../../src/agents/providers/claude/session/service.ts';
import { CodexCli } from '../../src/agents/providers/codex/cli/service.ts';
import {
  CodexProviderOptions,
  type CodexProviderSettings,
} from '../../src/agents/providers/codex/provider/schema.ts';
import { CodexProvider } from '../../src/agents/providers/codex/provider/service.ts';
import type { CodexRuntime } from '../../src/agents/providers/codex/session/schema.ts';
import { ProvidersLayer } from '../../src/agents/providers/layers.ts';
import { Providers } from '../../src/agents/providers/registry/service.ts';
import { ProviderCallFailed } from '../../src/agents/providers/schema.ts';
import type {
  AgentProvider,
  AgentSession,
  AgentSessionInput,
  AgentSessionResult,
  CompletionRequest,
  ProviderUsageReading,
  SessionArtifactStatus,
  SessionQuery,
  StructuredRequest,
} from '../../src/agents/providers/types.ts';
import { QuickCalls } from '../../src/agents/quick/service.ts';
import type { DeferredServer } from '../../src/extensions/loader/schema.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import type { Shell } from '../../src/shell/service.ts';
import type { Engine } from './engine.ts';

export interface PromiseSession {
  done: Promise<AgentSessionResult>;
  steer: (text: string, from?: 'you' | 'shinsa') => boolean;
  cancel: () => Promise<void>;
  hasPendingBackgroundWork?: () => boolean;
  loadMcpServers?: (
    servers: DeferredServer[],
    abandoned: AbortSignal
  ) => Promise<Record<string, string | null>>;
}

export type PromiseStarter = (input: AgentSessionInput) => PromiseSession;

export interface PromiseProvider {
  id: string;
  label: string;
  capabilities?: AgentProvider['capabilities'];
  startSession: PromiseStarter;
  compactSession?: (input: Omit<AgentSessionInput, 'prompt'>) => PromiseSession;
  inspectSession?: (query: SessionQuery) => Promise<SessionArtifactStatus>;
  listModels: () => Promise<AgentModel[]>;
  complete: (request: CompletionRequest) => Promise<string | null>;
  completeStructured?: (request: StructuredRequest) => Promise<unknown>;
  readLogin?: () => Promise<ProviderLogin>;
  readUsage?: () => Promise<ProviderUsageReading>;
}

const runtime = ManagedRuntime.make(Layer.merge(ShellLayer, JsonLogger));

function callFailed(provider: string) {
  return (error: unknown) =>
    new ProviderCallFailed({ provider, message: error instanceof Error ? error.message : String(error) });
}

export function adaptSession(session: PromiseSession): AgentSession {
  const { hasPendingBackgroundWork, loadMcpServers } = session;
  return {
    done: Effect.promise(() => session.done),
    steer: (text, from) => Effect.sync(() => session.steer(text, from)),
    cancel: Effect.promise(() => session.cancel()),
    ...(hasPendingBackgroundWork ? { hasPendingBackgroundWork: Effect.sync(hasPendingBackgroundWork) } : {}),
    ...(loadMcpServers
      ? { loadMcpServers: (servers, abandoned) => Effect.promise(() => loadMcpServers(servers, abandoned)) }
      : {}),
  };
}

export function adaptStarter(start: PromiseStarter): AgentProvider['startSession'] {
  return (input) => Effect.sync(() => adaptSession(start(input)));
}

function adaptProvider(provider: PromiseProvider): AgentProvider {
  const failed = callFailed(provider.id);
  const { compactSession, inspectSession, completeStructured, readLogin, readUsage } = provider;
  return {
    id: provider.id,
    label: provider.label,
    ...(provider.capabilities ? { capabilities: provider.capabilities } : {}),
    startSession: adaptStarter(provider.startSession),
    ...(compactSession
      ? { compactSession: (input) => Effect.sync(() => adaptSession(compactSession(input))) }
      : {}),
    ...(inspectSession ? { inspectSession: (query) => Effect.promise(() => inspectSession(query)) } : {}),
    listModels: Effect.promise(() => provider.listModels()),
    complete: (request) => Effect.tryPromise({ try: () => provider.complete(request), catch: failed }),
    ...(completeStructured
      ? {
          completeStructured: (request) =>
            Effect.tryPromise({ try: () => completeStructured(request), catch: failed }),
        }
      : {}),
    ...(readLogin ? { readLogin: Effect.promise(readLogin) } : {}),
    ...(readUsage ? { readUsage: Effect.tryPromise({ try: readUsage, catch: failed }) } : {}),
  };
}

export function createTestProviders(providers: (PromiseProvider | AgentProvider)[]) {
  return Providers.make(
    providers.map((provider) => (isEffectProvider(provider) ? provider : adaptProvider(provider)))
  );
}

function isEffectProvider(provider: PromiseProvider | AgentProvider): provider is AgentProvider {
  return Effect.isEffect(provider.listModels);
}

function toPromiseSession(session: AgentSession): PromiseSession {
  const { hasPendingBackgroundWork, loadMcpServers } = session;
  return {
    done: runtime.runPromise(session.done),
    steer: (text, from) => runtime.runSync(session.steer(text, from)),
    cancel: () => runtime.runPromise(session.cancel),
    ...(hasPendingBackgroundWork
      ? { hasPendingBackgroundWork: () => runtime.runSync(hasPendingBackgroundWork) }
      : {}),
    ...(loadMcpServers
      ? { loadMcpServers: (servers, abandoned) => runtime.runPromise(loadMcpServers(servers, abandoned)) }
      : {}),
  };
}

export function startScopedSession(
  start: Effect.Effect<AgentSession, never, Scope.Scope | Shell>
): PromiseSession {
  const scope = runtime.runSync(Scope.make());
  const session = runtime.runSync(start.pipe(Scope.provide(scope)));
  return {
    ...toPromiseSession(session),
    done: runtime.runPromise(session.done.pipe(Effect.ensuring(Scope.close(scope, Exit.void)))),
  };
}

export function startClaudeSession(input: AgentSessionInput, options: ClaudeSessionOptions): PromiseSession {
  return startScopedSession(
    makeClaudeSession(input, options).pipe(
      Effect.map((handle): AgentSession => ({
        ...handle,
        steer: (text, from = 'you') => handle.steer(text, from),
      }))
    )
  );
}

export function buildClaudeProvider(claude: ClaudeRuntime, settings: Partial<ClaudeProviderSettings> = {}) {
  return runtime.runSync(
    ClaudeProvider.use(Effect.succeed).pipe(
      Effect.provide(
        ClaudeProvider.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ClaudeSdk, claude),
              Layer.succeed(ClaudeProviderOptions, { eunoe: null, ...settings })
            )
          )
        )
      )
    )
  );
}

export function buildCodexProvider(codex: CodexRuntime, settings: CodexProviderSettings = {}) {
  return runtime.runSync(
    CodexProvider.use(Effect.succeed).pipe(
      Effect.provide(
        CodexProvider.layer.pipe(
          Layer.provide(
            Layer.mergeAll(Layer.succeed(CodexCli, codex), Layer.succeed(CodexProviderOptions, settings))
          )
        )
      )
    )
  );
}

export function startProviderSession(provider: AgentProvider, input: AgentSessionInput) {
  return startScopedSession(provider.startSession(input));
}

export function runProvider<A, E>(effect: Effect.Effect<A, E>) {
  return runtime.runPromise(effect);
}

export function buildDefaultProviders(claude: Partial<ClaudeProviderSettings> = {}) {
  return runtime.runSync(
    Providers.use(Effect.succeed).pipe(
      Effect.provide(
        ProvidersLayer.pipe(Layer.provide(Layer.succeed(ClaudeProviderOptions, { eunoe: null, ...claude })))
      )
    )
  );
}

export function createTestQuickCalls(
  engine: Engine,
  providers: Providers['Service'] = buildDefaultProviders()
) {
  return runtime.runSync(
    QuickCalls.use(Effect.succeed).pipe(
      Effect.provide(
        QuickCalls.layer.pipe(
          Layer.provide(
            Layer.merge(Layer.succeed(Providers, providers), Layer.succeed(EngineCore, engine.core))
          )
        )
      )
    )
  );
}
