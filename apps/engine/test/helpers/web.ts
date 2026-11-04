import type { AgentProviderInfo, Changelog } from '@shinsa/core';
import { Cause, Context, Effect, Exit, Layer, Logger, ManagedRuntime, References } from 'effect';
import { ensure } from 'effect/Array';
import { HttpRouter, HttpServer } from 'effect/http';
import { Accounts } from '../../src/accounts/roster/service.ts';
import type { ModelSource } from '../../src/agents/index.ts';
import { Providers } from '../../src/agents/providers/registry/service.ts';
import { Transcripts } from '../../src/agents/transcripts/service.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { Extensions } from '../../src/extensions/registry/service.ts';
import { GitLayer } from '../../src/git/layers.ts';
import type { EngineHandlerServices } from '../../src/http/app.ts';
import { Ingress } from '../../src/http/ingress/middleware.ts';
import {
  CommandLauncher,
  EngineModels,
  type Launcher,
  RequestSource,
  type RequestSourceShape,
  ServedChangelog,
  ServedInstance,
} from '../../src/http/schema.ts';
import { EngineServer } from '../../src/http/server/service.ts';
import type { ServerInstance } from '../../src/instance/index.ts';
import { EngineRestarter } from '../../src/instance/restart/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { Onboarding } from '../../src/onboarding/service.ts';
import { ProjectChanges } from '../../src/projects/changes/service.ts';
import { RemoteOrigin } from '../../src/remote/client/schema.ts';
import { TunnelGate } from '../../src/remote/gate/service.ts';
import { Remote } from '../../src/remote/machine/service.ts';
import { PlacementAsker } from '../../src/remote/placement/service.ts';
import type { PreviewLinks } from '../../src/remote/previews/schema.ts';
import { Previews } from '../../src/remote/previews/service.ts';
import type { ShareLinks } from '../../src/remote/shares/schema.ts';
import { Shares } from '../../src/remote/shares/service.ts';
import { RemoteStore } from '../../src/remote/store/service.ts';
import { TeamFeeds } from '../../src/remote/team-feeds/service.ts';
import { Teams } from '../../src/remote/teams/service.ts';
import type { RootSource } from '../../src/repos/index.ts';
import { Roots } from '../../src/repos/roots/service.ts';
import { ResourceMonitor } from '../../src/resources/monitor/service.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { Schedules } from '../../src/schedules/service.ts';
import { SecretStore } from '../../src/secrets/store/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import { Slack } from '../../src/slack/service.ts';
import { Evidence } from '../../src/store/evidence/service.ts';
import { ServiceRefiner } from '../../src/terminals/refine/service.ts';
import { Terminals } from '../../src/terminals/service.ts';
import { CommandRouter } from '../../src/triage/router/service.ts';
import { Versions } from '../../src/versions/service.ts';
import { Workspaces } from '../../src/workspaces/service.ts';
import { Engine } from './engine.ts';
import { openEventLog } from './event-log.ts';
import { createTestEvidence } from './evidence.ts';
import { createTempDir, createTestConfig } from './index.ts';
import { createTestTranscripts } from './transcripts.ts';

export interface HttpContext {
  engine: Engine;
  remote?: Remote['Service'];
  remoteStore?: RemoteStore['Service'];
  remoteOrigin?: string;
  shares?: ShareLinks;
  teams?: Teams['Service'];
  teamFeeds?: TeamFeeds['Service'];
  previews?: PreviewLinks;
  slack?: Slack['Service'];
  config: ServerConfig;
  instance?: ServerInstance;
  evidence: Evidence['Service'];
  models: ModelSource;
  providers?: { readonly listProviders: Effect.Effect<readonly AgentProviderInfo[]> };
  onboarding: Onboarding['Service'];
  launch?: Launcher;
  accounts?: Accounts['Service'];
  schedules?: Schedules['Service'];
  secrets?: SecretStore['Service'];
  transcripts: Transcripts['Service'];
  extensions?: Extensions['Service'];
  versions?: Versions['Service'];
  changelog?: Changelog;
  roots?: RootSource;
  projects?: ProjectChanges['Service'];
  router?: CommandRouter['Service'];
  place?: PlacementAsker['Service'];
  workspaces?: Workspaces['Service'];
  restarter?: EngineRestarter['Service'];
  terminals?: Terminals['Service'];
  refiner?: ServiceRefiner['Service'];
  resources?: Pick<ResourceMonitor['Service'], 'subscribe' | 'snapshot'>;
}

const OPTIONAL_SERVICES = [
  ['remote', Remote],
  ['remoteStore', RemoteStore],
  ['shares', Shares],
  ['teams', Teams],
  ['teamFeeds', TeamFeeds],
  ['previews', Previews],
  ['slack', Slack],
  ['accounts', Accounts],
  ['schedules', Schedules],
  ['secrets', SecretStore],
  ['extensions', Extensions],
  ['versions', Versions],
  ['roots', Roots],
  ['projects', ProjectChanges],
  ['router', CommandRouter],
  ['place', PlacementAsker],
  ['workspaces', Workspaces],
  ['restarter', EngineRestarter],
  ['terminals', Terminals],
  ['refiner', ServiceRefiner],
  ['resources', ResourceMonitor],
] as const satisfies readonly (readonly [keyof HttpContext, unknown])[];

export function createHttpContext(
  overrides: Partial<HttpContext> = {},
  config: Partial<ServerConfig> = {}
): HttpContext {
  const resolved = createTestConfig(createTempDir(), config);
  const engine = new Engine(openEventLog(resolved.databasePath));
  return {
    engine,
    config: resolved,
    transcripts: createTestTranscripts(resolved.transcriptsDir),
    evidence: createTestEvidence(resolved.evidenceDir),
    models: { listModels: Effect.succeed([]) } as unknown as HttpContext['models'],
    onboarding: {} as HttpContext['onboarding'],
    ...overrides,
  };
}

export function createHttpLayer(context: HttpContext): Layer.Layer<EngineHandlerServices> {
  const optional = OPTIONAL_SERVICES.flatMap(([field, tag]) => {
    const value = context[field];
    return value === undefined ? [] : [Layer.succeed(tag as Context.Key<unknown, unknown>, value)];
  });
  const required = Layer.mergeAll(
    Layer.succeed(EngineCore, context.engine.core),
    Layer.succeed(EngineConfig, context.config),
    Layer.succeed(Evidence, context.evidence),
    Layer.succeed(Transcripts, context.transcripts),
    Layer.succeed(EngineModels, context.models),
    Layer.succeed(Onboarding, context.onboarding),
    context.instance === undefined ? Layer.empty : Layer.succeed(ServedInstance, context.instance),
    context.changelog === undefined ? Layer.empty : Layer.succeed(ServedChangelog, context.changelog),
    context.launch === undefined ? Layer.empty : Layer.succeed(CommandLauncher, context.launch),
    context.remoteOrigin === undefined ? Layer.empty : Layer.succeed(RemoteOrigin, context.remoteOrigin),
    context.providers === undefined
      ? Layer.empty
      : Layer.succeed(Providers, context.providers as unknown as Providers['Service'])
  );
  return Layer.mergeAll(required, ...optional) as Layer.Layer<EngineHandlerServices>;
}

const handlers: { dispose: () => Promise<void> }[] = [];

export const recordedLogs: { message: string; fields: Record<string, unknown> }[] = [];

const RecordingLogger = Logger.layer([
  Logger.make(({ fiber, message }) => {
    recordedLogs.push({
      message: ensure(message).map(String).join(' '),
      fields: { ...fiber.getRef(References.CurrentLogAnnotations) },
    });
  }),
]);

export async function disposeWebHandlers() {
  for (const handler of handlers.splice(0)) await handler.dispose();
  recordedLogs.splice(0);
}

type RouteNeeds =
  | EngineHandlerServices
  | TunnelGate
  | HttpRouter.HttpRouter
  | Layer.Success<typeof HttpServer.layerServices>
  | Layer.Success<typeof GitLayer>
  | HttpRouter.Request<'Requires' | 'Error' | 'GlobalRequires' | 'GlobalError', unknown>;

export function createWebHandler<E, R extends RouteNeeds>(
  context: HttpContext,
  routes: Layer.Layer<never, E, R>
) {
  const web = HttpRouter.toWebHandler(
    Layer.mergeAll(routes, Ingress).pipe(
      Layer.provide(TunnelGate.layer),
      Layer.provide(GitLayer.pipe(Layer.provideMerge(ShellLayer))),
      Layer.provide(HttpServer.layerServices),
      Layer.provide(createHttpLayer(context)),
      Layer.provideMerge(RecordingLogger)
    ),
    { disableLogger: true }
  );
  handlers.push(web);
  const handle = web.handler as (request: Request, context: Context.Context<never>) => Promise<Response>;
  return (request: Request, source?: RequestSourceShape) =>
    handle(request, source ? Context.make(RequestSource, source) : Context.empty());
}

export function startHttpServer(context: HttpContext) {
  const runtime = ManagedRuntime.make(
    EngineServer.layer.pipe(Layer.provide(createHttpLayer(context)), Layer.provideMerge(JsonLogger))
  );
  const started = runtime.runSyncExit(EngineServer.use(Effect.succeed));
  if (Exit.isFailure(started)) {
    void runtime.dispose();
    throw Cause.squash(started.cause);
  }
  return { server: started.value, url: started.value.url, stop: () => runtime.dispose() };
}
