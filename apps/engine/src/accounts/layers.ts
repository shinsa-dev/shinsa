import { Layer } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { AccountFolders } from './folders/service.ts';
import { AccountRegistry } from './registry/service.ts';
import { UsageApi } from './usage/service.ts';

export const AccountsLayer = Layer.mergeAll(
  AccountRegistry.layer,
  AccountFolders.layer,
  UsageApi.layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false))
  )
);
