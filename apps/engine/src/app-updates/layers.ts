import type { ShinsaBuild } from '@shinsa/core';
import { Effect, type FileSystem, Layer } from 'effect';
import type { Shell } from '../shell/service.ts';
import { openAppInBackground, resolveEngineApp } from './open.ts';
import { AppUpdates } from './service.ts';

export const AppUpdatesLayer = (engine: ShinsaBuild, program: string = process.execPath) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const context = yield* Effect.context<Shell | FileSystem.FileSystem>();
      return AppUpdates.layer({
        app: yield* resolveEngineApp(program),
        engine,
        open: (app) => openAppInBackground(app).pipe(Effect.provide(context)),
      });
    })
  );
