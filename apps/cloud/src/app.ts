import { RemoteApi } from '@shinsa/core/remote/api';
import { Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import type { SqlClient } from 'effect/sql';
import { MachineSessionLive } from './auth/machine-session/middleware.ts';
import { PageSessionLive } from './auth/page-session/middleware.ts';
import { RequestGateLive } from './http/gate/middleware.ts';
import { Ingress } from './http/ingress/middleware.ts';
import { type Assets, WorkerLogger } from './http/worker.ts';
import { CloudServices } from './layers.ts';
import { HookRoutes } from './routes/hooks/handler.ts';
import { InstancesHandlers } from './routes/instances/handler.ts';
import { MachineTeamsHandlers } from './routes/machine-teams/handler.ts';
import { MachineHandlers } from './routes/machine/handler.ts';
import { PairingHandlers } from './routes/pairing/handler.ts';
import { PairsHandlers } from './routes/pairs/handler.ts';
import { PreviewOpenRoutes } from './routes/preview-open/handler.ts';
import { PreviewHost } from './routes/previews/service.ts';
import { SessionHandlers } from './routes/session/handler.ts';
import { SharesHandlers } from './routes/shares/handler.ts';
import { SignInRoutes } from './routes/sign-in/handler.ts';
import { SlackEventRoutes } from './routes/slack-events/handler.ts';
import { SlackLinkRoutes } from './routes/slack-link/handler.ts';
import { SlackRelayHandlers } from './routes/slack-relay/handler.ts';
import { TeamsHandlers } from './routes/teams/handler.ts';

const ApiRoutes = HttpApiBuilder.layer(RemoteApi).pipe(
  Layer.provide([
    SessionHandlers,
    PairingHandlers,
    PairsHandlers,
    InstancesHandlers,
    SharesHandlers,
    TeamsHandlers,
    MachineHandlers,
    MachineTeamsHandlers,
    SlackRelayHandlers,
  ]),
  Layer.provide([RequestGateLive, PageSessionLive, MachineSessionLive])
);

const CloudRoutes = Layer.mergeAll(
  ApiRoutes,
  SignInRoutes,
  SlackLinkRoutes,
  SlackEventRoutes,
  HookRoutes,
  PreviewOpenRoutes,
  Ingress.pipe(Layer.provide(PreviewHost.layer))
);

export type CloudPlatform = SqlClient.SqlClient | Assets;

export const makeCloudHandler = <E>(platform: Layer.Layer<CloudPlatform, E>) =>
  HttpRouter.toWebHandler(
    CloudRoutes.pipe(
      Layer.provideMerge(CloudServices),
      Layer.provideMerge(platform),
      Layer.provideMerge(WorkerLogger),
      Layer.provide(HttpServer.layerServices)
    ),
    { disableLogger: true }
  );
