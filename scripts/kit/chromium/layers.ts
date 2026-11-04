import { BunServices } from '@effect/platform-bun';
import { Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { Chromium } from './service.ts';

export const ChromiumLayer = Chromium.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer))
);
