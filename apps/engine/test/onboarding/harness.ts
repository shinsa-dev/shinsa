import { BunServices } from '@effect/platform-bun';
import { Context, Duration, Effect, Layer, Scope } from 'effect';
import type { ModelSource } from '../../src/agents/index.ts';
import type { QuickJson } from '../../src/agents/quick/schema.ts';
import { QuickCalls } from '../../src/agents/quick/service.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { JsonFile } from '../../src/files/service.ts';
import {
  type AccountSource,
  type InstallTerminals,
  Onboarding,
  Prerequisites,
  SetupCommands,
} from '../../src/onboarding/index.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import type { CommandResult } from '../../src/shell/index.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import { Shell } from '../../src/shell/service.ts';
import type { Engine } from '../helpers/engine.ts';
import type { createTestMachine } from '../helpers/machine.ts';
import { type Promised, promised } from '../helpers/promised.ts';

export type FakeCommand = (
  command: string[],
  cwd: string,
  options?: { timeoutMs?: number }
) => Promise<CommandResult>;

export interface TestOnboardingOptions {
  engine: Engine;
  config: ServerConfig;
  machine: ReturnType<typeof createTestMachine>['context'];
  run?: FakeCommand;
  ask?: QuickJson;
  models?: ModelSource;
  accounts?: AccountSource;
  terminals?: InstallTerminals | null;
}

function createFakeShell(run: FakeCommand) {
  return Layer.succeed(
    Shell,
    Shell.of({
      run: (request) =>
        Effect.promise(() =>
          run(
            [...request.argv],
            request.cwd,
            request.timeout ? { timeoutMs: Duration.toMillis(request.timeout) } : {}
          )
        ),
      stopTree: () => Effect.void,
    })
  );
}

function createOnboardingLayer(options: TestOnboardingOptions) {
  const ask: QuickJson = options.ask ?? (() => Effect.succeed(null));
  return Onboarding.layer({
    models: options.models ?? { listModels: Effect.succeed([]) },
    accounts: options.accounts ?? Effect.succeed([]),
    terminals: options.terminals ?? null,
  }).pipe(
    Layer.provide(Prerequisites.layer),
    Layer.provide(SetupCommands.layer),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeedContext(options.machine),
        Layer.succeed(EngineConfig, options.config),
        Layer.succeed(EngineCore, options.engine.core),
        Layer.succeed(QuickCalls, QuickCalls.of({ classify: ask, write: ask })),
        JsonFile.layer,
        options.run ? createFakeShell(options.run) : ShellLayer
      )
    ),
    Layer.provide(BunServices.layer)
  );
}

export function createTestOnboardingService(options: TestOnboardingOptions) {
  const context = Effect.runSync(
    Layer.buildWithScope(createOnboardingLayer(options), Effect.runSync(Scope.make()))
  );
  return Context.get(context, Onboarding);
}

export type TestOnboarding = Promised<Onboarding['Service']>;

export function createPromisedOnboarding(options: TestOnboardingOptions): TestOnboarding {
  return promised(createTestOnboardingService(options));
}
