import { EngineApi } from '@shinsa/core/engine-api';
import { type Context, Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { GitLayer } from '../git/layers.ts';
import { JsonLogger } from '../log/service.ts';
import { TunnelGate } from '../remote/gate/service.ts';
import { ShellLayer } from '../shell/layers.ts';
import { EngineGateLive } from './gate/middleware.ts';
import { Ingress } from './ingress/middleware.ts';
import { AccountsHandlers } from './routes/accounts/handler.ts';
import { ChangelogHandlers } from './routes/changelog/handler.ts';
import { CodeHandlers } from './routes/code/handler.ts';
import { CommandsHandlers } from './routes/commands/handler.ts';
import { ExtensionsHandlers } from './routes/extensions/handler.ts';
import { FilesHandlers } from './routes/files/handler.ts';
import { OnboardingHandlers } from './routes/onboarding/handler.ts';
import { PlacementHandlers } from './routes/placement/handler.ts';
import { ProjectsHandlers } from './routes/projects/handler.ts';
import { RemoteHandlers } from './routes/remote/handler.ts';
import { SecretsHandlers } from './routes/secrets/handler.ts';
import { ServerHandlers } from './routes/server/handler.ts';
import { ServicesHandlers } from './routes/services/handler.ts';
import { SignInRoutes } from './routes/sign-in/handler.ts';
import { SlackHandlers } from './routes/slack/handler.ts';
import { StateHandlers } from './routes/state/handler.ts';
import { TasksHandlers } from './routes/tasks/handler.ts';
import { TeamsHandlers } from './routes/teams/handler.ts';
import { TerminalsHandlers } from './routes/terminals/handler.ts';
import { TunnelRoutes } from './routes/tunnel/handler.ts';
import { VersionsHandlers } from './routes/versions/handler.ts';
import { WebhookRoutes } from './routes/webhooks/handler.ts';

export const ApiRoutes = HttpApiBuilder.layer(EngineApi).pipe(
  Layer.provide([
    TasksHandlers,
    CodeHandlers,
    CommandsHandlers,
    ServerHandlers,
    FilesHandlers,
    StateHandlers,
    OnboardingHandlers,
    AccountsHandlers,
    SecretsHandlers,
    ExtensionsHandlers,
    VersionsHandlers,
    ChangelogHandlers,
    RemoteHandlers,
    TeamsHandlers,
    PlacementHandlers,
    SlackHandlers,
    ProjectsHandlers,
    TerminalsHandlers,
    ServicesHandlers,
  ]),
  Layer.provide(EngineGateLive)
);

const EngineRoutes = Layer.mergeAll(ApiRoutes, WebhookRoutes, SignInRoutes, TunnelRoutes);

const EngineHandlerLayer = Layer.mergeAll(EngineRoutes, Ingress).pipe(
  Layer.provide(TunnelGate.layer),
  Layer.provide(GitLayer.pipe(Layer.provide(ShellLayer))),
  Layer.provide(HttpServer.layerServices)
);

export type EngineHandlerServices = Exclude<
  Layer.Services<typeof EngineHandlerLayer>,
  HttpRouter.HttpRouter | HttpRouter.Request<'Requires' | 'Error' | 'GlobalRequires' | 'GlobalError', unknown>
>;

export const makeEngineHandler = (services: Context.Context<EngineHandlerServices>) =>
  HttpRouter.toWebHandler(
    EngineHandlerLayer.pipe(Layer.provide(Layer.succeedContext(services)), Layer.provideMerge(JsonLogger)),
    { disableLogger: true }
  );
