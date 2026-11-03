import { REMOTE_APP_ORIGIN } from '@shinsa/core';
import { Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { PairPollInterval } from '../pairing/schema.ts';
import { Pairings } from '../pairing/service.ts';
import { RemoteOrigin } from './schema.ts';
import { RemoteClient } from './service.ts';

export interface RemoteControlOptions {
  origin?: string;
  fetch?: typeof globalThis.fetch;
  pairPollMs?: number;
}

export class RemoteControl {
  readonly origin: string;
  readonly layer: Layer.Layer<RemoteClient | Pairings>;

  constructor(options: RemoteControlOptions = {}) {
    const settings = Layer.mergeAll(
      options.origin === undefined ? Layer.empty : Layer.succeed(RemoteOrigin, options.origin),
      options.fetch ? Layer.succeed(FetchHttpClient.Fetch, options.fetch) : Layer.empty,
      options.pairPollMs === undefined ? Layer.empty : Layer.succeed(PairPollInterval, options.pairPollMs)
    );
    const client = RemoteClient.layer.pipe(Layer.provide(FetchHttpClient.layer));
    this.layer = Pairings.layer.pipe(Layer.provideMerge(client), Layer.provide(settings));
    this.origin = options.origin ?? REMOTE_APP_ORIGIN;
  }
}
