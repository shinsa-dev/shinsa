import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { MachineResources, Task } from '@shinsa/core';
import { Deferred, Duration, Effect } from 'effect';
import { readMemoryWith, readResourceText } from '../../src/resources/memory.ts';
import { ResourceReadFailed } from '../../src/resources/monitor/schema.ts';
import { ResourceTimings } from '../../src/resources/schema.ts';
import type { CommandResult } from '../../src/shell/schema.ts';
import { runFiles } from '../harness.ts';
import { captureLogs } from '../helpers/logs.ts';
import { createTempDir } from '../helpers/temp.ts';
import { until } from '../helpers/until.ts';
import { run, runAsync } from '../terminals/harness.ts';
import { createMonitor, type ResourceCommand, result } from './harness.ts';

const GB = 1024 ** 3;

const DF = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/x 4000 1000 3000 25% /';

function createTasks(): Record<string, Pick<Task, 'id' | 'stage' | 'worktreePath'>> {
  return {
    'task-a': { id: 'task-a', stage: 'building', worktreePath: '/wt/a' },
    'task-b': { id: 'task-b', stage: 'planning', worktreePath: null },
    'task-c': { id: 'task-c', stage: 'merged', worktreePath: '/wt/c' },
    'task-d': { id: 'task-d', stage: 'building', worktreePath: '/wt/d' },
  };
}

interface MonitorOptions {
  table?: string[];
  disk?: boolean;
  diskIntervalMs?: number;
  primeMs?: number;
}

function createSampledMonitor(options: MonitorOptions = {}) {
  const tables = [
    ...(options.table ?? [
      '  100 1 100 1024 0:01.00\n  300 1 300 512 0:00.00',
      '  100 1 100 2048 0:03.00\n  300 1 300 512 0:00.50',
    ]),
  ];
  const calls: string[][] = [];
  let busy = 0;
  const runCommand: ResourceCommand = (argv) =>
    Effect.suspend(() =>
      Effect.andThen(
        Effect.yieldNow,
        Effect.sync(() => argv)
      )
    ).pipe(
      Effect.map((command) => {
        calls.push([...command]);
        if (command[0] === 'ps') return result(tables.shift() ?? '');
        if (command[0] === 'df') return result(DF, options.disk !== false);
        if (command[0] === 'du') return result(command[2] === '/wt/a' ? '1024\t/wt/a' : '');
        return result('');
      })
    );
  const harness = createMonitor({
    run: runCommand,
    tasks: createTasks(),
    services: [{ taskId: 'task-d', pid: 300 }],
    cpuTimes: () => {
      busy += 5;
      return { busy, total: busy * 4 };
    },
    memory: Effect.succeed({ usedBytes: 40 * GB, totalBytes: 32 * GB }),
    timings: {
      interval: 5,
      prime: options.primeMs ?? 60_000,
      ...(options.diskIntervalMs === undefined ? {} : { diskInterval: options.diskIntervalMs }),
    },
  });
  run(Effect.asVoid(harness.ledger.track('task-a', 'agent', 100)));
  return {
    ...harness,
    calls,
    advance: (ms: number) => {
      harness.time.now += ms;
    },
  };
}

function listen(
  subscribe: (listener: (resources: MachineResources) => void) => Effect.Effect<Effect.Effect<void>>
) {
  const seen: MachineResources[] = [];
  const unsubscribe = run(subscribe((resources) => seen.push(resources)));
  return { seen, unsubscribe };
}

describe('the resource monitor', () => {
  test('samples twice before it reports, then counts each open task toward its processes and worktree', async () => {
    const { monitor, advance, calls, close } = createSampledMonitor();
    const { seen, unsubscribe } = listen(monitor.subscribe);
    await runAsync(monitor.refresh);
    advance(1000);
    await runAsync(monitor.refresh);
    const latest = seen.at(-1);
    expect(run(monitor.snapshot)).toEqual(latest ?? null);
    expect(latest).toMatchObject({
      sampledAt: 1000,
      cores: 2,
      memoryUsedBytes: 32 * GB,
      memoryTotalBytes: 32 * GB,
      diskFreeBytes: 3000 * 1024,
      diskTotalBytes: 4000 * 1024,
    });
    expect(latest?.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(latest?.tasks).toEqual([
      {
        taskId: 'task-a',
        agent: { cpuPercent: 100, memoryBytes: 2048 * 1024 },
        services: { cpuPercent: 0, memoryBytes: 0 },
        checks: { cpuPercent: 0, memoryBytes: 0 },
        processes: 1,
        worktreeBytes: 1024 * 1024,
      },
      {
        taskId: 'task-d',
        agent: { cpuPercent: 0, memoryBytes: 0 },
        services: { cpuPercent: 25, memoryBytes: 512 * 1024 },
        checks: { cpuPercent: 0, memoryBytes: 0 },
        processes: 1,
        worktreeBytes: null,
      },
    ]);
    expect(calls.filter((argv) => argv[0] === 'du').map((argv) => argv[2])).toEqual(['/wt/a', '/wt/d']);
    await runAsync(unsubscribe);
    await close();
  });

  test('lists a task with only a measured worktree, and measures the disk again once it is stale', async () => {
    const { monitor, advance, calls, close } = createSampledMonitor({
      table: ['  1 0 1 10 0:00.00', '  1 0 1 10 0:00.00', '  1 0 1 10 0:00.00'],
      diskIntervalMs: 500,
    });
    const { seen } = listen(monitor.subscribe);
    await runAsync(monitor.refresh);
    advance(1000);
    await runAsync(monitor.refresh);
    await until('the disk to be measured again', () => calls.filter((argv) => argv[0] === 'df').length === 2);
    expect(seen.at(-1)?.tasks.map((task) => [task.taskId, task.processes, task.worktreeBytes])).toEqual([
      ['task-a', 0, 1024 * 1024],
    ]);
    await close();
  });

  test('a failed df leaves the disk unknown and a failed ps counts no processes', async () => {
    const { monitor, advance, close } = createSampledMonitor({ disk: false, table: ['bad', 'bad'] });
    const { seen } = listen(monitor.subscribe);
    await runAsync(monitor.refresh);
    advance(1000);
    await runAsync(monitor.refresh);
    expect(seen.at(-1)).toMatchObject({ diskFreeBytes: null, diskTotalBytes: null });
    await close();
  });

  test('a slow du holds back neither the first reading nor the disk free', async () => {
    const finish = run(Deferred.make<CommandResult>());
    const tables = ['  100 1 100 1024 0:01.00', '  100 1 100 1024 0:02.00'];
    const runCommand: ResourceCommand = (argv) => {
      if (argv[2] === '/wt/a') return Deferred.await(finish);
      return Effect.andThen(
        Effect.yieldNow,
        Effect.sync(() => result(argv[0] === 'df' ? DF : (tables.shift() ?? '')))
      );
    };
    const { monitor, time, close } = createMonitor({
      run: runCommand,
      tasks: createTasks(),
      cpuTimes: (now) => ({ busy: now, total: now * 4 }),
      memory: Effect.succeed({ usedBytes: GB, totalBytes: 2 * GB }),
    });
    const { seen } = listen(monitor.subscribe);
    await runAsync(monitor.refresh);
    time.now = 1000;
    await runAsync(monitor.refresh);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ diskFreeBytes: 3000 * 1024, tasks: [] });
    run(Deferred.succeed(finish, result('1024\t/wt/a')));
    await runAsync(monitor.measureDisk);
    time.now = 2000;
    await runAsync(monitor.refresh);
    expect(seen.at(-1)?.tasks.map((task) => task.worktreeBytes)).toEqual([1024 * 1024]);
    await close();
  });

  test('samples on a timer only while someone listens, and not after it stops', async () => {
    const { monitor, advance, close } = createSampledMonitor({
      table: Array(50).fill('  100 1 100 1024 0:01.00'),
      primeMs: 1,
    });
    const seen: MachineResources[] = [];
    const unsubscribe = run(
      monitor.subscribe((resources) => {
        advance(1000);
        seen.push(resources);
      })
    );
    const tick = setInterval(() => advance(1000), 1);
    await until('two samples', () => seen.length >= 2);
    await runAsync(unsubscribe);
    const count = seen.length;
    await Bun.sleep(20);
    expect(seen.length).toBeLessThanOrEqual(count + 1);
    const snapshot = run(monitor.snapshot);
    await close();
    const after = seen.length;
    await Bun.sleep(20);
    clearInterval(tick);
    expect(seen).toHaveLength(after);
    expect(snapshot).not.toBeNull();
  });

  test('a sample that fails is logged and the next one runs', async () => {
    const logs = captureLogs();
    const { monitor, close } = createMonitor({
      memory: Effect.fail(new ResourceReadFailed({ message: 'memory is gone' })),
    });
    await runAsync(monitor.refresh);
    await runAsync(monitor.refresh);
    logs.restore();
    expect(run(monitor.snapshot)).toBeNull();
    expect(logs.fieldsOf('[Resources] Could not read this machine’s resource use')).toHaveLength(2);
    await close();
  });
});

describe('reading the machine’s own numbers', () => {
  test('a monitor with nothing faked reads this machine', async () => {
    const dataDir = createTempDir();
    await Bun.write(join(dataDir, 'note.txt'), 'hello');
    expect(await runFiles(readResourceText(join(dataDir, 'note.txt')))).toBe('hello');
    const missing = await runFiles(Effect.flip(readResourceText(join(dataDir, 'missing.txt'))));
    expect(missing._tag).toBe('ResourceReadFailed');
    const { monitor, ledger, close } = createMonitor({
      machine: true,
      dataDir,
      tasks: { 'task-a': { id: 'task-a', stage: 'building', worktreePath: dataDir } },
      timings: { prime: 1 },
    });
    run(Effect.asVoid(ledger.track('task-a', 'agent', process.pid)));
    const { seen } = listen(monitor.subscribe);
    await until(
      'a sample of this machine with its disk',
      () => seen.some((sample) => sample.diskFreeBytes !== null),
      5_000
    );
    await close();
    const sample = seen.find((reading) => reading.diskFreeBytes !== null);
    expect(sample?.memoryTotalBytes).toBeGreaterThan(0);
    expect(sample?.diskFreeBytes).toBeGreaterThan(0);
    expect(sample?.tasks[0]?.agent.memoryBytes).toBeGreaterThan(0);
  });

  test('memory comes from /proc on Linux, vm_stat on macOS and the os elsewhere', async () => {
    const vmStat = () =>
      Effect.succeed(result('Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 1.'));
    const read = (text: string) => () => Effect.succeed(text);
    const linux = readMemoryWith('linux', vmStat, read('MemTotal: 100 kB\nMemAvailable: 40 kB\n'));
    expect(await runAsync(linux)).toEqual({ usedBytes: 60 * 1024, totalBytes: 100 * 1024 });
    const mac = await runAsync(readMemoryWith('darwin', vmStat, read('')));
    expect(mac?.totalBytes).toBeGreaterThan(0);
    const failed = readMemoryWith('darwin', () => Effect.succeed(result('', false)), read(''));
    expect(await runAsync(failed)).toBeNull();
    const other = await runAsync(readMemoryWith('win32', vmStat, read('')));
    expect(other?.usedBytes).toBeLessThanOrEqual(other?.totalBytes ?? 0);
    expect(await runAsync(readMemoryWith('linux', vmStat, read('')))).toBeNull();
  });
});

describe('how often the monitor reads', () => {
  test('every 5 s while someone listens, a second after the first, and the disk every 10 minutes', () => {
    const timings = run(
      Effect.gen(function* () {
        return yield* ResourceTimings;
      })
    );
    expect([timings.interval, timings.prime, timings.diskInterval].map(Duration.toMillis)).toEqual([
      5_000, 1_000, 600_000,
    ]);
  });
});
