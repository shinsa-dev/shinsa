import type { ShinsaState } from '@shinsa/core';
import { Clock, Context, Duration, Effect, Exit, Layer, Scope } from 'effect';
import { EngineConfig } from '../../src/config/service.ts';
import { JsonFile } from '../../src/files/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { TerminalPty } from '../../src/terminals/pty/service.ts';
import { TerminalIds, TerminalTimings } from '../../src/terminals/schema.ts';
import { Terminals } from '../../src/terminals/service.ts';
import { TerminalFiles } from '../../src/terminals/store/service.ts';
import { createFixedClock } from '../helpers/clock.ts';
import { createConfigAt } from '../helpers/config.ts';
import { createStubEngine } from '../helpers/state.ts';
import { createTempDir } from '../helpers/temp.ts';
import { createFakeSpawner } from './fakes.ts';

export function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runSync(Effect.provide(effect, JsonLogger));
}

export function runAsync<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(Effect.provide(effect, JsonLogger));
}

export interface TerminalsHarnessOptions {
  dataDir?: string;
  readOnly?: boolean;
  pty?: Partial<TerminalPty['Service']>;
  home?: string;
  now?: number | (() => number);
  tasks?: ShinsaState['tasks'];
  idPrefix?: string;
  env?: Record<string, string>;
}

function buildScoped<A, E>(layer: Layer.Layer<A, E>) {
  const scope = Effect.runSync(Scope.make());
  const context = Effect.runSync(Layer.buildWithScope(Layer.provide(layer, JsonLogger), scope));
  return { context, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
}

function createTerminalsLayer(options: TerminalsHarnessOptions = {}) {
  const dataDir = options.dataDir ?? createTempDir();
  const fake = createFakeSpawner();
  let id = 0;
  const pty = TerminalPty.of({
    spawn: (command, spawnOptions) => Effect.sync(() => fake.spawn(command, spawnOptions)),
    readForeground: () => Effect.succeed('vim'),
    pickPort: (preferred, taken) =>
      Effect.sync(() => {
        if (preferred !== null && !taken.has(preferred)) return preferred;
        let port = 5001;
        while (taken.has(port)) port++;
        return port;
      }),
    ...options.pty,
  });
  const config = createConfigAt(createTempDir(), {
    dataDir,
    userHome: options.home ?? '/home/ada',
    inspect: options.readOnly ?? false,
  });
  const env = options.env ?? { SHELL: '/bin/fish', PATH: '/bin' };
  const now = options.now ?? 100;
  const layer = Terminals.layer({ version: '1.0.0', env }).pipe(
    Layer.provide(
      Layer.mergeAll(
        TerminalFiles.layer.pipe(Layer.provide(JsonFile.layer)),
        Layer.succeed(TerminalPty, pty),
        Layer.succeed(EngineConfig, config),
        Layer.succeed(
          TerminalIds,
          Effect.sync(() => `${options.idPrefix ?? 'term'}-${++id}`)
        ),
        Layer.succeed(TerminalTimings, { notify: Duration.millis(1), screen: Duration.millis(1) }),
        Layer.succeed(Clock.Clock, createFixedClock(typeof now === 'function' ? now : () => now)),
        options.tasks
          ? Layer.succeed(
              EngineCore,
              createStubEngine((state) => Object.assign(state.tasks, options.tasks)).engine.core
            )
          : Layer.empty
      )
    )
  );
  return { layer, fake, dataDir };
}

export function createTerminals(options: TerminalsHarnessOptions = {}) {
  const { layer, fake, dataDir } = createTerminalsLayer(options);
  const { context, close } = buildScoped(layer);
  return { terminals: Context.get(context, Terminals), fake, dataDir, close };
}
