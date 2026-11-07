import { BunSocket } from '@effect/platform-bun';
import { Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { AccessScope } from './access/service.ts';
import { RemoteClient } from './client/service.ts';
import { DeviceChannels } from './device-channel/service.ts';
import { FleetRelay } from './fleet-relay/service.ts';
import { Handoffs } from './handoffs/service.ts';
import { TunnelHealth } from './health/service.ts';
import type { RemoteInput } from './machine/schema.ts';
import { Remote } from './machine/service.ts';
import { RemoteUrlOpener } from './opener/service.ts';
import { Pairings } from './pairing/service.ts';
import { PlacementAsker } from './placement/service.ts';
import { Presence } from './presence/service.ts';
import { ShareDescriber } from './share-describe/service.ts';
import { Shares } from './shares/service.ts';
import { RemoteStore } from './store/service.ts';
import { TeamFeeds } from './team-feeds/service.ts';
import { Teams } from './teams/service.ts';

export const RemoteClientLayer = Pairings.layer.pipe(
  Layer.provideMerge(RemoteClient.layer),
  Layer.provide(FetchHttpClient.layer)
);

export const RemoteEdgeLayer = Layer.merge(
  RemoteUrlOpener.layer,
  TunnelHealth.layer.pipe(Layer.provide(FetchHttpClient.layer))
);

export const RemoteMachineLayer = (input: RemoteInput) =>
  Remote.layer(input).pipe(
    Layer.provideMerge(Layer.mergeAll(RemoteStore.layer, AccessScope.layer, RemoteClientLayer))
  );

export const RemoteLayer = (input: RemoteInput) =>
  Layer.merge(
    Teams.layer,
    FleetRelay.layer.pipe(
      Layer.provide(DeviceChannels.layer.pipe(Layer.provide(BunSocket.layerWebSocketConstructor)))
    )
  ).pipe(
    Layer.provideMerge(Layer.mergeAll(Shares.layer, TeamFeeds.layer, Handoffs.layer, Presence.layer)),
    Layer.provideMerge(RemoteMachineLayer(input))
  );

export const RemoteQuickLayer = Layer.merge(PlacementAsker.layer, ShareDescriber.layer);
