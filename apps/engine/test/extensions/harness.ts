import { createState, type ExtensionPlace, type LoadedExtensions, type ShinsaState } from '@shinsa/core';
import { Clock, Effect, Layer, ManagedRuntime } from 'effect';
import type { ServerConfig } from '../../src/config/schema.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { ExtensionDiscovery } from '../../src/extensions/discovery/service.ts';
import { McpClients } from '../../src/extensions/health/service.ts';
import { ExtensionsServices } from '../../src/extensions/layers.ts';
import type { FetchLike } from '../../src/extensions/oauth/schema.ts';
import { Extensions } from '../../src/extensions/registry/service.ts';
import type { Env, McpCheckedStatus, McpDefinition } from '../../src/extensions/schema.ts';
import type { SessionExtensions } from '../../src/extensions/session.ts';
import { ExtensionFiles } from '../../src/extensions/store/service.ts';
import { UsageIndex } from '../../src/extensions/usage-index/service.ts';
import { ExtensionUsage } from '../../src/extensions/usage/service.ts';
import { JsonFile } from '../../src/files/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import type { EngineCore as EngineCoreService } from '../../src/runtime/engine/service.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { SecretFiles } from '../../src/secrets/files/service.ts';
import { SecretStore } from '../../src/secrets/store/service.ts';
import { createFixedClock } from '../helpers/clock.ts';
import { createConfigAt } from '../helpers/config.ts';
import { createTempDir } from '../helpers/temp.ts';

export interface ExtensionsWorldOptions {
  config?: Partial<ServerConfig>;
  root?: string;
  state?: () => ShinsaState;
  env?: Env;
  fetch?: FetchLike;
  check?: (definition: McpDefinition) => Effect.Effect<McpCheckedStatus>;
  discovery?: (real: ExtensionDiscovery['Service']) => ExtensionDiscovery['Service'];
  usage?: (real: ExtensionUsage['Service']) => ExtensionUsage['Service'];
  redirectUrl?: () => string;
  now?: () => number;
}

const REDIRECT_URL = 'http://127.0.0.1:5180/api/mcp/oauth/callback';

const runtimes: { dispose: () => Promise<void> }[] = [];

export function disposeExtensionWorlds() {
  return Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
}

export function createFoundation(options: ExtensionsWorldOptions = {}) {
  const config = createConfigAt(options.root ?? createTempDir(), options.config);
  const state = options.state ?? createState;
  const { check, discovery, usage } = options;
  const clients = check
    ? Layer.effect(
        McpClients,
        Effect.gen(function* () {
          const real = yield* McpClients;
          return McpClients.of({ ...real, check: (definition) => check(definition) });
        })
      ).pipe(Layer.provide(McpClients.layer))
    : McpClients.layer;
  const discoveries = discovery
    ? Layer.effect(
        ExtensionDiscovery,
        Effect.gen(function* () {
          return ExtensionDiscovery.of(discovery(yield* ExtensionDiscovery));
        })
      ).pipe(Layer.provide(ExtensionDiscovery.layer))
    : ExtensionDiscovery.layer;
  const usages = usage
    ? Layer.effect(
        ExtensionUsage,
        Effect.gen(function* () {
          return ExtensionUsage.of(usage(yield* ExtensionUsage));
        })
      ).pipe(Layer.provide(ExtensionUsage.layer))
    : ExtensionUsage.layer;
  const engine = Layer.succeed(EngineCore, {
    state: Effect.sync(() => state()),
  } as unknown as EngineCoreService['Service']);
  return Layer.mergeAll(
    usages,
    discoveries,
    clients,
    engine,
    SecretStore.layer.pipe(Layer.provide(SecretFiles.layer))
  ).pipe(
    Layer.provideMerge(ExtensionFiles.layer),
    Layer.provideMerge(Layer.succeed(EngineConfig, config)),
    Layer.provideMerge(JsonFile.layer),
    Layer.provideMerge(JsonLogger),
    Layer.provideMerge(options.now ? Layer.succeed(Clock.Clock, createFixedClock(options.now)) : Layer.empty)
  );
}

function createExtensionsRuntime(options: ExtensionsWorldOptions = {}) {
  const services = ExtensionsServices({
    env: options.env ?? {},
    fetch: options.fetch,
    redirectUrl: Effect.sync(options.redirectUrl ?? (() => REDIRECT_URL)),
  });
  const layer = Layer.provideMerge(services, createFoundation(options));
  const runtime = ManagedRuntime.make(layer);
  runtimes.push(runtime);
  return runtime;
}

export function openExtensions(options: ExtensionsWorldOptions = {}) {
  const runtime = createExtensionsRuntime(options);
  const extensions = runtime.runSync(Extensions.use(Effect.succeed));
  const sync = <A, E>(effect: Effect.Effect<A, E>) => runtime.runSync(effect);
  const run = <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect);
  return {
    service: extensions,
    refreshUsage: () => runtime.runPromise(UsageIndex.use((usage) => usage.refresh)),
    snapshot: () => sync(extensions.snapshot),
    readSnapshot: () => sync(extensions.readSnapshot),
    syncSnapshot: () => sync(extensions.syncSnapshot),
    syncUsage: () => run(extensions.syncUsage),
    stop: () => run(extensions.stop),
    createServer: (fields: unknown) => sync(extensions.createServer(fields)),
    updateServer: (id: unknown, fields: unknown) => sync(extensions.updateServer(id, fields)),
    removeServer: (id: unknown) => sync(extensions.removeServer(id)),
    updateServerChoice: (id: unknown, fields: unknown) => sync(extensions.updateServerChoice(id, fields)),
    updateSkillChoice: (id: unknown, enabled: unknown) => sync(extensions.updateSkillChoice(id, enabled)),
    updatePluginChoice: (id: unknown, enabled: unknown) => sync(extensions.updatePluginChoice(id, enabled)),
    updateOptimizer: (fields: unknown) => sync(extensions.updateOptimizer(fields)),
    check: (id?: unknown) => run(extensions.check(id)),
    startSignIn: (id: unknown) => run(extensions.startSignIn(id)),
    finishSignIn: (url: URL) => run(extensions.finishSignIn(url)),
    signOut: (id: unknown) => sync(extensions.signOut(id)),
    resolveSession: (place: ExtensionPlace, pin: LoadedExtensions | null = null) =>
      run(extensions.resolveSession(place, pin)),
    createLoader: (session: SessionExtensions) => sync(extensions.createLoader(session)),
    secrets: {
      selectMcpCredentials: (serverId: string) =>
        runtime.runPromise(SecretStore.use((store) => store.selectMcpCredentials(serverId))),
      updateMcpCredentials: (serverId: string, patch: Record<string, unknown>) =>
        runtime.runPromise(SecretStore.use((store) => store.updateMcpCredentials(serverId, patch))),
    },
  };
}
