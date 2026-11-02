import { BunServices } from '@effect/platform-bun';
import { Layer, ManagedRuntime } from 'effect';
import { JsonLogger } from '../log/service.ts';
import { Shell } from '../shell/service.ts';

export const edgeRuntime = ManagedRuntime.make(
  Layer.mergeAll(JsonLogger, Shell.layer.pipe(Layer.provide(BunServices.layer)))
);
