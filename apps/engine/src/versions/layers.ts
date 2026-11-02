import { Layer } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { NpmRegistry } from './registry/service.ts';

export const VersionsLayer = NpmRegistry.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false))
);
