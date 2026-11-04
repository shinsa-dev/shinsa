import { isTaskSettled, type MachineResources, type TaskResources } from '@shinsa/core';
import { Clock, Context, Deferred, Duration, Effect, FiberHandle, Layer, Ref, Schedule } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import type { Argv } from '../../shell/schema.ts';
import { ProcessLedger } from '../ledger/service.ts';
import { ResourceMachine } from '../machine/service.ts';
import {
  createProcessUse,
  parseDiskFree,
  parseDiskUsage,
  parseProcessTable,
  resolveCpuPercent,
  resolveTaskUse,
} from '../sample.ts';
import {
  type Baseline,
  type DiskSample,
  PROCESS_TABLE,
  type ResourceListener,
  ResourceTimings,
} from '../schema.ts';

export class ResourceMonitor extends Context.Service<
  ResourceMonitor,
  {
    readonly snapshot: Effect.Effect<MachineResources | null>;
    subscribe(listener: ResourceListener): Effect.Effect<Effect.Effect<void>>;
    readonly refresh: Effect.Effect<void>;
    readonly measureDisk: Effect.Effect<void>;
  }
>()('shinsa/engine/resources/monitor/ResourceMonitor') {
  static readonly layer = Layer.effect(
    ResourceMonitor,
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const machine = yield* ResourceMachine;
      const ledger = yield* ProcessLedger;
      const engine = yield* EngineCore;
      const { dataDir } = yield* EngineConfig;
      const timings = yield* ResourceTimings;
      const clock = yield* Clock.Clock;
      const listeners = yield* Ref.make<ReadonlySet<ResourceListener>>(new Set());
      const latest = yield* Ref.make<MachineResources | null>(null);
      const baseline = yield* Ref.make<Baseline | null>(null);
      const disk = yield* Ref.make<DiskSample | null>(null);
      const stopped = yield* Ref.make(false);
      const polling = yield* FiberHandle.make<void>();

      const run = (argv: Argv) => machine.run(argv, dataDir);

      const singleFlight = Effect.fn('ResourceMonitor.singleFlight')(function* (work: Effect.Effect<void>) {
        const running = yield* Ref.make<Deferred.Deferred<void> | null>(null);
        return Effect.gen(function* () {
          const flight = yield* Deferred.make<void>();
          const claimed = yield* Ref.modify(running, (current) =>
            current ? [current, current] : [flight, flight]
          );
          if (claimed === flight)
            yield* Effect.forkIn(
              work.pipe(
                Effect.ensuring(Effect.andThen(Ref.set(running, null), Deferred.succeed(flight, undefined)))
              ),
              scope,
              { startImmediately: true }
            );
          yield* Deferred.await(claimed);
        });
      });

      const listOpenTasks = Effect.map(engine.state, (state) =>
        Object.values(state.tasks).filter((task) => !isTaskSettled(task))
      );

      const compareTaskUse = (left: TaskResources, right: TaskResources) => {
        const memory = (task: TaskResources) =>
          task.agent.memoryBytes + task.services.memoryBytes + task.checks.memoryBytes;
        return memory(right) - memory(left) || left.taskId.localeCompare(right.taskId);
      };

      const measure = Effect.gen(function* () {
        const listing = yield* run(['df', '-k', '-P', dataDir]);
        const free = listing.ok ? parseDiskFree(listing.stdout) : null;
        const before = yield* Ref.get(disk);
        yield* Ref.set(disk, {
          at: before?.at ?? Number.NEGATIVE_INFINITY,
          disk: free,
          worktrees: before?.worktrees ?? new Map(),
        });
        const worktrees = new Map<string, number | null>();
        for (const task of yield* listOpenTasks) {
          if (!task.worktreePath) continue;
          const usage = yield* run(['du', '-sk', task.worktreePath]);
          worktrees.set(task.id, parseDiskUsage(usage.stdout));
        }
        yield* Ref.set(disk, { at: yield* clock.currentTimeMillis, disk: free, worktrees });
      });

      const measureDisk = yield* singleFlight(measure);

      const sample = Effect.gen(function* () {
        const known = yield* Ref.get(disk);
        if (!known || (yield* clock.currentTimeMillis) - known.at >= Duration.toMillis(timings.diskInterval))
          yield* Effect.forkIn(measureDisk, scope, { startImmediately: true });
        const table = yield* run(PROCESS_TABLE);
        const memory = yield* machine.memory;
        const cpu = yield* machine.cpuTimes;
        const at = yield* clock.currentTimeMillis;
        const rows = table.ok ? parseProcessTable(table.stdout) : [];
        const before = yield* Ref.getAndSet(baseline, {
          at,
          cpu,
          processes: new Map(rows.map((row) => [row.pid, row.cpuSeconds])),
        });
        const listening = yield* Ref.get(listeners);
        if (!before || !memory || listening.size === 0) return;
        const capacitySeconds = ((at - before.at) / 1000) * machine.cores;
        const use = resolveTaskUse(rows, yield* ledger.listRoots, before.processes, capacitySeconds);
        const worktrees = (yield* Ref.get(disk))?.worktrees;
        const tasks = (yield* listOpenTasks).flatMap((task): TaskResources[] => {
          const found = use.get(task.id);
          const worktreeBytes = worktrees?.get(task.id) ?? null;
          if (!found && worktreeBytes === null) return [];
          const { agent, services, checks, processes } = found ?? createProcessUse();
          return [{ taskId: task.id, agent, services, checks, processes, worktreeBytes }];
        });
        const measured = yield* Ref.get(disk);
        const resources: MachineResources = {
          sampledAt: at,
          cores: machine.cores,
          cpuPercent: resolveCpuPercent(before.cpu, cpu),
          memoryUsedBytes: Math.min(memory.usedBytes, memory.totalBytes),
          memoryTotalBytes: memory.totalBytes,
          diskFreeBytes: measured?.disk?.freeBytes ?? null,
          diskTotalBytes: measured?.disk?.totalBytes ?? null,
          tasks: tasks.sort(compareTaskUse),
        };
        yield* Ref.set(latest, resources);
        yield* Effect.sync(() => {
          for (const listener of listening) listener(resources);
        });
      });

      const refresh = yield* singleFlight(
        sample.pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[Resources] Could not read this machine’s resource use').pipe(
              Effect.annotateLogs({ error: failure.message })
            )
          )
        )
      );

      const pause = Effect.andThen(FiberHandle.clear(polling), Ref.set(baseline, null));

      const resume = Effect.gen(function* () {
        if (yield* Ref.get(stopped)) return;
        yield* Effect.forkIn(refresh, scope);
        yield* FiberHandle.run(
          polling,
          Effect.andThen(
            Effect.sleep(timings.prime),
            Effect.repeat(refresh, Schedule.spaced(timings.interval))
          )
        );
      });

      const subscribe = Effect.fn('ResourceMonitor.subscribe')(function* (listener: ResourceListener) {
        const listening = yield* Ref.updateAndGet(listeners, (current) => new Set(current).add(listener));
        if (listening.size === 1) yield* resume;
        return Effect.gen(function* () {
          const left = yield* Ref.updateAndGet(listeners, (current) => {
            const next = new Set(current);
            next.delete(listener);
            return next;
          });
          if (left.size === 0) yield* pause;
        });
      });

      const stop = Effect.gen(function* () {
        yield* Ref.set(stopped, true);
        yield* Ref.set(listeners, new Set());
        yield* pause;
      });

      yield* Effect.addFinalizer(() => stop);

      return ResourceMonitor.of({ snapshot: Ref.get(latest), subscribe, refresh, measureDisk });
    })
  );
}
