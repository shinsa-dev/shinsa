import { RemoteApi } from '@shinsa/core/remote/api';
import { Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import type { SqlClient } from 'effect/sql';
import { MachineSessionLive, PageSessionLive } from './auth/sessions.ts';
import { RequestGateLive } from './http/gate.ts';
import { Ingress } from './http/ingress.ts';
import { type Assets, WorkerLogger } from './http/worker.ts';
import { CloudServices } from './layers.ts';
import { HookRoutes } from './routes/hooks.ts';
import { InstancesHandlers, MachineHandlers, SharesHandlers } from './routes/machines.ts';
import { PairingHandlers, PairsHandlers } from './routes/pairing.ts';
import { PreviewOpenRoutes } from './routes/previews.ts';
import { SessionHandlers } from './routes/session.ts';
import { SignInRoutes } from './routes/sign-in.ts';
import { SlackEventRoutes } from './routes/slack-events.ts';
import { SlackLinkRoutes } from './routes/slack-link.ts';
import { SlackRelayHandlers } from './routes/slack-relay.ts';
import { MachineTeamsHandlers, TeamsHandlers } from './routes/teams.ts';

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
  Ingress
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
