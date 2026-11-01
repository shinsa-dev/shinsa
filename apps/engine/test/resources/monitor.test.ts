import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { MachineResources, Task } from '@shinsa/core';
import {
  createMemoryReader,
  ProcessLedger,
  type ResourceCommand,
  ResourceMonitor,
  readCpuTimes,
  readTextFile,
} from '../../src/resources/index.ts';
import type { CommandResult } from '../../src/shell/index.ts';
import { createTempDir, until } from '../helpers/index.ts';

const GB = 1024 ** 3;

function result(stdout: string, ok = true): CommandResult {
  return { ok, code: ok ? 0 : 1, stdout, stderr: '', timedOut: false };
}

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

function createMonitor(options: MonitorOptions = {}) {
  const tables = [
    ...(options.table ?? [
      '  100 1 100 1024 0:01.00\n  300 1 300 512 0:00.00',
      '  100 1 100 2048 0:03.00\n  300 1 300 512 0:00.50',
    ]),
  ];
  const calls: string[][] = [];
  let clock = 0;
  let busy = 0;
  const run: ResourceCommand = (argv) => {
    calls.push(argv);
    if (argv[0] === 'ps') return Promise.resolve(result(tables.shift() ?? ''));
    if (argv[0] === 'df') {
      const df = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/x 4000 1000 3000 25% /';
      return Promise.resolve(result(df, options.disk !== false));
    }
    if (argv[0] === 'du') return Promise.resolve(result(argv[2] === '/wt/a' ? '1024\t/wt/a' : ''));
    return Promise.resolve(result(''));
  };
  const ledger = new ProcessLedger(() => [{ taskId: 'task-d', pid: 300 }]);
  ledger.track('task-a', 'agent', 100);
  const monitor = new ResourceMonitor({
    ledger,
    state: () => ({ tasks: createTasks() as unknown as Record<string, Task> }),
    dataDir: '/data',
    run,
    cores: 2,
    now: () => clock,
    readCpuTimes: () => {
      busy += 5;
      return { busy, total: busy * 4 };
    },
    readMemory: () => Promise.resolve({ usedBytes: 40 * GB, totalBytes: 32 * GB }),
    intervalMs: 5,
    primeMs: options.primeMs ?? 60_000,
    ...(options.diskIntervalMs === undefined ? {} : { diskIntervalMs: options.diskIntervalMs }),
  });
  return {
    monitor,
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('the resource monitor', () => {
  test('samples twice before it reports, then counts each open task toward its processes and worktree', async () => {
    const { monitor, advance, calls } = createMonitor();
    const seen: MachineResources[] = [];
    const unsubscribe = monitor.subscribe((resources) => seen.push(resources));
    await monitor.refresh();
    advance(1000);
    await monitor.refresh();
    const latest = seen.at(-1);
    expect(monitor.snapshot()).toEqual(latest ?? null);
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
    unsubscribe();
    monitor.stop();
  });

  test('lists a task with only a measured worktree, and measures the disk again once it is stale', async () => {
    const { monitor, advance, calls } = createMonitor({
      table: ['  1 0 1 10 0:00.00', '  1 0 1 10 0:00.00', '  1 0 1 10 0:00.00'],
      diskIntervalMs: 500,
    });
    const seen: MachineResources[] = [];
    monitor.subscribe((resources) => seen.push(resources));
    await monitor.refresh();
    advance(1000);
    await monitor.refresh();
    await until('the disk to be measured again', () => calls.filter((argv) => argv[0] === 'df').length === 2);
    expect(seen.at(-1)?.tasks.map((task) => [task.taskId, task.processes, task.worktreeBytes])).toEqual([
      ['task-a', 0, 1024 * 1024],
    ]);
    monitor.stop();
  });

  test('a failed df leaves the disk unknown and a failed ps counts no processes', async () => {
    const { monitor, advance } = createMonitor({ disk: false, table: ['bad', 'bad'] });
    const seen: MachineResources[] = [];
    monitor.subscribe((resources) => seen.push(resources));
    await monitor.refresh();
    advance(1000);
    await monitor.refresh();
    expect(seen.at(-1)).toMatchObject({ diskFreeBytes: null, diskTotalBytes: null });
    monitor.stop();
  });

  test('samples on a timer only while someone listens, and not after it stops', async () => {
    const { monitor, advance } = createMonitor({
      table: Array(50).fill('  100 1 100 1024 0:01.00'),
      primeMs: 1,
    });
    const seen: MachineResources[] = [];
    const unsubscribe = monitor.subscribe((resources) => {
      advance(1000);
      seen.push(resources);
    });
    const tick = setInterval(() => advance(1000), 1);
    await until('two samples', () => seen.length >= 2);
    unsubscribe();
    const count = seen.length;
    await Bun.sleep(20);
    expect(seen.length).toBeLessThanOrEqual(count + 1);
    monitor.stop();
    monitor.subscribe((resources) => seen.push(resources));
    await Bun.sleep(20);
    clearInterval(tick);
    expect(monitor.snapshot()).not.toBeNull();
  });

  test('a sample that throws is logged and the next one runs', async () => {
    const monitor = new ResourceMonitor({
      ledger: new ProcessLedger(),
      state: () => ({ tasks: {} }),
      dataDir: '/data',
      run: () => Promise.reject(new Error('ps is gone')),
    });
    await monitor.refresh();
    await monitor.refresh();
    expect(monitor.snapshot()).toBeNull();
  });
});

describe('reading the machine’s own numbers', () => {
  test('a monitor with nothing injected reads this machine', async () => {
    const dataDir = createTempDir();
    await Bun.write(join(dataDir, 'note.txt'), 'hello');
    expect(await readTextFile(join(dataDir, 'note.txt'))).toBe('hello');
    const ledger = new ProcessLedger();
    ledger.track('task-a', 'agent', process.pid);
    const monitor = new ResourceMonitor({
      ledger,
      state: () => ({
        tasks: { 'task-a': { id: 'task-a', stage: 'building', worktreePath: dataDir } as Task },
      }),
      dataDir,
    });
    const seen: MachineResources[] = [];
    monitor.subscribe((resources) => seen.push(resources));
    await until('a sample of this machine', () => seen.length > 0, 5_000);
    monitor.stop();
    expect(seen[0]?.memoryTotalBytes).toBeGreaterThan(0);
    expect(seen[0]?.diskFreeBytes).toBeGreaterThan(0);
    expect(seen[0]?.tasks[0]?.agent.memoryBytes).toBeGreaterThan(0);
  });

  test('cpu times add up across cores', () => {
    const times = readCpuTimes();
    expect(times.total).toBeGreaterThanOrEqual(times.busy);
  });

  test('memory comes from /proc on Linux, vm_stat on macOS and the os elsewhere', async () => {
    const run: ResourceCommand = () =>
      Promise.resolve(result('Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 1.'));
    const linux = createMemoryReader('linux', run, () =>
      Promise.resolve('MemTotal: 100 kB\nMemAvailable: 40 kB\n')
    );
    expect(await linux()).toEqual({ usedBytes: 60 * 1024, totalBytes: 100 * 1024 });
    const mac = await createMemoryReader('darwin', run)();
    expect(mac?.totalBytes).toBeGreaterThan(0);
    expect(await createMemoryReader('darwin', () => Promise.resolve(result('', false)))()).toBeNull();
    const other = await createMemoryReader('win32', run)();
    expect(other?.usedBytes).toBeLessThanOrEqual(other?.totalBytes ?? 0);
    const real = await createMemoryReader('linux', run, () => Promise.resolve(''))();
    expect(real).toBeNull();
  });
});
