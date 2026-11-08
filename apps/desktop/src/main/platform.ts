import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Layer } from 'effect';

export const PlatformLive = BunChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.merge(BunFileSystem.layer, BunPath.layer))
);
