import type { ProgramId } from '@shinsa/core';
import { Context, Effect, Layer, Scope } from 'effect';
import type { ProgramLocation } from '../../src/agents/providers/versions/schema.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import type { CommandResult } from '../../src/shell/schema.ts';
import { ProgramInstalls } from '../../src/versions/installs/service.ts';
import { NpmRegistry } from '../../src/versions/registry/service.ts';
import {
  type LineListener,
  NpmRegistryFailed,
  type SdkVersions,
  type Updater,
  type VersionsCallFailed,
  type VersionsInput,
} from '../../src/versions/schema.ts';
import { Versions } from '../../src/versions/service.ts';
import { UpdaterRunner } from '../../src/versions/updater/service.ts';
import { resolveUpdater } from '../../src/versions/updaters.ts';
import { createTestConfig } from '../helpers/index.ts';

export interface FakePrograms {
  locate?: (program: ProgramId) => ProgramLocation;
  readVersion?: (program: ProgramId, path: string) => string | null;
  minimum?: (program: ProgramId) => string;
  sdk?: SdkVersions;
  latest?: (name: string) => Effect.Effect<string, NpmRegistryFailed>;
  updater?: (program: ProgramId, path: string) => Updater;
  run?: (updater: Updater, onLine: LineListener) => Effect.Effect<CommandResult, VersionsCallFailed>;
}

export function createFakeVersionsLayer(fake: FakePrograms = {}) {
  const installs = Layer.succeed(
    ProgramInstalls,
    ProgramInstalls.of({
      locate: (program) =>
        Effect.sync(() => fake.locate?.(program) ?? { path: `/opt/bin/${program}`, override: null }),
      readVersion: (program, path) => Effect.sync(() => fake.readVersion?.(program, path) ?? null),
      minimum: (program) =>
        Effect.sync(() => fake.minimum?.(program) ?? (program === 'claude' ? '2.1.280' : '0.153.0')),
      sdk: Effect.sync(() => fake.sdk ?? { version: '0.3.280', claudeCodeVersion: '2.1.280' }),
      updater: (program, path) => Effect.sync(() => (fake.updater ?? resolveUpdater)(program, path)),
    })
  );
  const registry = Layer.succeed(
    NpmRegistry,
    NpmRegistry.of({
      latest: (name) =>
        fake.latest?.(name) ??
        Effect.fail(new NpmRegistryFailed({ packageName: name, message: `No ${name}.` })),
    })
  );
  const { run } = fake;
  const runner = run
    ? Layer.succeed(UpdaterRunner, UpdaterRunner.of({ run: (updater, onLine) => run(updater, onLine) }))
    : UpdaterRunner.layer.pipe(Layer.provide(ShellLayer));
  return Layer.mergeAll(installs, registry, runner);
}

export function createVersionsLayer<R>(
  programs: Layer.Layer<ProgramInstalls | NpmRegistry | UpdaterRunner, never, R>,
  options: { inspect?: boolean; onUpdated?: VersionsInput['onUpdated'] } = {}
) {
  return Versions.layer({ onUpdated: options.onUpdated ?? (() => Effect.void) }).pipe(
    Layer.provide(programs),
    Layer.provide(
      Layer.succeed(EngineConfig, createTestConfig(undefined, { inspect: options.inspect ?? false }))
    )
  );
}

export function buildFakeVersions(fake: FakePrograms = {}) {
  return Effect.runSync(
    Layer.buildWithScope(createVersionsLayer(createFakeVersionsLayer(fake)), Scope.makeUnsafe()).pipe(
      Effect.map((context) => Context.get(context, Versions)),
      Effect.provide(JsonLogger)
    )
  );
}
