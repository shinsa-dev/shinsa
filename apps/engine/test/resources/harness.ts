import type { ShinsaState, Task } from '@shinsa/core';
import { Clock, Context, Duration, Effect, Exit, Layer, Scope } from 'effect';
import { EngineConfig } from '../../src/config/service.ts';
import { ProcessLedger } from '../../src/resources/ledger/service.ts';
import { ResourceMachine } from '../../src/resources/machine/service.ts';
import { ResourceReadFailed } from '../../src/resources/monitor/schema.ts';
import { ResourceMonitor } from '../../src/resources/monitor/service.ts';
import { type MemoryReading, ResourceTimings } from '../../src/resources/schema.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import type { CommandResult } from '../../src/shell/schema.ts';
import { Terminals } from '../../src/terminals/service.ts';
import { createFixedClock } from '../helpers/clock.ts';
import { createConfigAt } from '../helpers/config.ts';
import { createTempDir } from '../helpers/temp.ts';

export type ResourceCommand = (argv: readonly string[]) => Effect.Effect<CommandResult>;

export interface MonitorHarnessOptions {
  run?: ResourceCommand;
  tasks?: Record<string, Pick<Task, 'id' | 'stage' | 'worktreePath'>>;
  services?: { taskId: string; pid: number }[];
  dataDir?: string;
  cores?: number;
  cpuTimes?: (now: number) => { busy: number; total: number };
  memory?: Effect.Effect<MemoryReading | null, ResourceReadFailed>;
  machine?: boolean;
  timings?: { interval?: number; prime?: number; diskInterval?: number };
}

export function result(stdout: string, ok = true): CommandResult {
  return { ok, code: ok ? 0 : 1, stdout, stderr: '', timedOut: false };
}

function createStubTerminals(services: { taskId: string; pid: number }[] = []) {
  return Layer.succeed(Terminals, {
    listServiceProcesses: Effect.sync(() => services),
  } as unknown as Terminals['Service']);
}

function createStubEngine(state: () => Pick<ShinsaState, 'tasks'>) {
  return Layer.succeed(EngineCore, {
    state: Effect.sync(() => state() as ShinsaState),
  } as unknown as EngineCore['Service']);
}

export function createMonitor(options: MonitorHarnessOptions = {}) {
  const time = { now: 0 };
  const dataDir = options.dataDir ?? '/data';
  const fakeMachine = Layer.succeed(
    ResourceMachine,
    ResourceMachine.of({
      cores: options.cores ?? 2,
      cpuTimes: Effect.sync(() => options.cpuTimes?.(time.now) ?? { busy: 0, total: 0 }),
      memory: options.memory ?? Effect.fail(new ResourceReadFailed({ message: 'no memory' })),
      run: (argv) => (options.run ?? (() => Effect.succeed(result(''))))(argv),
    })
  );
  const timings = options.timings ?? {};
  const references = Layer.mergeAll(
    Layer.succeed(EngineConfig, { ...createConfigAt(createTempDir()), dataDir }),
    createStubEngine(() => ({ tasks: (options.tasks ?? {}) as Record<string, Task> })),
    Layer.succeed(ResourceTimings, {
      interval: Duration.millis(timings.interval ?? 5),
      prime: Duration.millis(timings.prime ?? 60_000),
      diskInterval: Duration.millis(timings.diskInterval ?? 600_000),
    }),
    options.machine === true
      ? Layer.empty
      : Layer.succeed(
          Clock.Clock,
          createFixedClock(() => time.now)
        )
  );
  const layer = ResourceMonitor.layer.pipe(
    Layer.provideMerge(ProcessLedger.layer),
    Layer.provide(
      options.machine === true ? ResourceMachine.layer.pipe(Layer.provide(ShellLayer)) : fakeMachine
    ),
    Layer.provide(createStubTerminals(options.services)),
    Layer.provide(references)
  );
  const scope = Effect.runSync(Scope.make());
  const context = Effect.runSync(Layer.buildWithScope(layer, scope));
  return {
    monitor: Context.get(context, ResourceMonitor),
    ledger: Context.get(context, ProcessLedger),
    time,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}
