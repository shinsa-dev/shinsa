import { cpus } from 'node:os';
import { Duration, Effect, Scope } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { readMemoryWith, readResourceText } from './memory.ts';
import { type ResourceMonitorHandle, ResourceReadFailed } from './monitor/schema.ts';
import { makeResourceMonitor } from './monitor/service.ts';
import {
  type CpuTimes,
  DISK_INTERVAL_MS,
  type MemoryReading,
  PRIME_DELAY_MS,
  RESOURCE_INTERVAL_MS,
  type ResourceCommand,
  type ResourceListener,
  type ResourceMonitorOptions,
} from './schema.ts';

export { ProcessLedger } from './ledger.ts';
export type { ProcessTracker, ResourceCommand, ResourceMonitorOptions } from './schema.ts';

export function readCpuTimes(): CpuTimes {
  return cpus().reduce(
    (sum, cpu) => {
      const busy = cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq;
      return { busy: sum.busy + busy, total: sum.total + busy + cpu.times.idle };
    },
    { busy: 0, total: 0 }
  );
}

export function readTextFile(path: string) {
  return edgeRuntime.runPromise(readResourceText(path));
}

function enterPromise<A>(work: () => Promise<A>) {
  return Effect.tryPromise({
    try: work,
    catch: (error) => new ResourceReadFailed({ message: describeError(error) }),
  });
}

export function createMemoryReader(
  platform: NodeJS.Platform,
  run: ResourceCommand,
  readText: (path: string) => Promise<string> = readTextFile
) {
  return (): Promise<MemoryReading | null> =>
    edgeRuntime.runPromise(
      readMemoryWith(
        platform,
        (argv) => enterPromise(() => run([...argv])),
        (path) => enterPromise(() => readText(path))
      )
    );
}

export class ResourceMonitor {
  readonly #handle: ResourceMonitorHandle;

  constructor(options: ResourceMonitorOptions) {
    const { run, readMemory, now } = options;
    this.#handle = edgeRuntime.runSync(
      makeResourceMonitor({
        dataDir: options.dataDir,
        roots: Effect.sync(() => options.ledger.listRoots()),
        state: Effect.sync(options.state),
        run: run ? (argv) => enterPromise(() => run([...argv])) : null,
        readCpuTimes: Effect.sync(options.readCpuTimes ?? readCpuTimes),
        readMemory: readMemory ? enterPromise(readMemory) : null,
        cores: options.cores ?? cpus().length,
        now: Effect.sync(now ?? Date.now),
        interval: Duration.millis(options.intervalMs ?? RESOURCE_INTERVAL_MS),
        prime: Duration.millis(options.primeMs ?? PRIME_DELAY_MS),
        diskInterval: Duration.millis(options.diskIntervalMs ?? DISK_INTERVAL_MS),
      }).pipe(Scope.provide(edgeRuntime.runSync(Scope.make())))
    );
  }

  snapshot() {
    return edgeRuntime.runSync(this.#handle.snapshot);
  }

  subscribe(listener: ResourceListener) {
    const unsubscribe = edgeRuntime.runSync(this.#handle.subscribe(listener));
    return () => {
      edgeRuntime.runFork(unsubscribe);
    };
  }

  refresh() {
    return edgeRuntime.runPromise(this.#handle.refresh);
  }

  measureDisk() {
    return edgeRuntime.runPromise(this.#handle.measureDisk);
  }

  stop() {
    edgeRuntime.runFork(this.#handle.stop);
  }
}
