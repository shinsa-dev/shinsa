import { Layer } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';

export const OutboundHttp = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false))
);
