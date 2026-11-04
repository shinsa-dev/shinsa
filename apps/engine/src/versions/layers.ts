import { Layer } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { ProgramVersions } from '../agents/providers/versions/service.ts';
import { ProgramInstalls } from './installs/service.ts';
import { NpmRegistry } from './registry/service.ts';
import { UpdaterRunner } from './updater/service.ts';

export const VersionsLayer = Layer.mergeAll(
  NpmRegistry.layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false))
  ),
  ProgramInstalls.layer.pipe(Layer.provide(ProgramVersions.layer)),
  UpdaterRunner.layer
);
