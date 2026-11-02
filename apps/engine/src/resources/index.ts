import { cpus, freemem, totalmem } from 'node:os';
import { isTaskSettled, type MachineResources, type TaskResources } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import { runCommand } from '../shell/index.ts';
import { startPolling } from './poller.ts';
import {
  createProcessUse,
  parseDiskFree,
  parseDiskUsage,
  parseMemInfo,
  parseProcessTable,
  parseVmStat,
  resolveCpuPercent,
  resolveTaskUse,
} from './sample.ts';
import {
  type Baseline,
  type CpuTimes,
  DISK_INTERVAL_MS,
  type DiskSample,
  MEMINFO_PATH,
  type MemoryReading,
  PRIME_DELAY_MS,
  PROCESS_TABLE,
  RESOURCE_COMMAND_TIMEOUT_MS,
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
  return Bun.file(path).text();
}

export function createMemoryReader(
  platform: NodeJS.Platform,
  run: ResourceCommand,
  readText: (path: string) => Promise<string> = readTextFile
) {
  return async (): Promise<MemoryReading | null> => {
    if (platform === 'linux') return parseMemInfo(await readText(MEMINFO_PATH));
    if (platform === 'darwin') {
      const result = await run(['vm_stat']);
      return result.ok ? parseVmStat(result.stdout, totalmem()) : null;
    }
    return { usedBytes: totalmem() - freemem(), totalBytes: totalmem() };
  };
}

function compareTaskUse(left: TaskResources, right: TaskResources) {
  const memory = (task: TaskResources) =>
    task.agent.memoryBytes + task.services.memoryBytes + task.checks.memoryBytes;
  return memory(right) - memory(left) || left.taskId.localeCompare(right.taskId);
}

export class ResourceMonitor {
  readonly #options: ResourceMonitorOptions;
  readonly #run: ResourceCommand;
  readonly #readCpuTimes: () => CpuTimes;
  readonly #readMemory: () => Promise<MemoryReading | null>;
  readonly #now: () => number;
  readonly #listeners = new Set<ResourceListener>();
  #latest: MachineResources | null = null;
  #baseline: Baseline | null = null;
  #disk: DiskSample | null = null;
  #measuringDisk: Promise<void> | null = null;
  #sampling: Promise<void> | null = null;
  #stopPolling: (() => void) | null = null;
  #stopped = false;

  constructor(options: ResourceMonitorOptions) {
    this.#options = options;
    this.#run =
      options.run ??
      ((argv) => runCommand(argv, options.dataDir, { timeoutMs: RESOURCE_COMMAND_TIMEOUT_MS }));
    this.#readCpuTimes = options.readCpuTimes ?? readCpuTimes;
    this.#readMemory = options.readMemory ?? createMemoryReader(process.platform, this.#run);
    this.#now = options.now ?? Date.now;
  }

  snapshot() {
    return this.#latest;
  }

  subscribe(listener: ResourceListener) {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) this.#resume();
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#pause();
    };
  }

  refresh() {
    this.#sampling ??= this.#sample()
      .catch((error: unknown) => {
        log.warn('[Resources] Could not read this machine’s resource use', { error: describeError(error) });
      })
      .finally(() => {
        this.#sampling = null;
      });
    return this.#sampling;
  }

  measureDisk() {
    this.#measuringDisk ??= this.#measure()
      .catch((error: unknown) => {
        log.warn('[Resources] Could not measure this machine’s disk', { error: describeError(error) });
      })
      .finally(() => {
        this.#measuringDisk = null;
      });
    return this.#measuringDisk;
  }

  stop() {
    this.#stopped = true;
    this.#listeners.clear();
    this.#pause();
  }

  #resume() {
    if (this.#stopped) return;
    void this.refresh();
    this.#stopPolling = startPolling(
      () => this.refresh(),
      this.#options.primeMs ?? PRIME_DELAY_MS,
      this.#options.intervalMs ?? RESOURCE_INTERVAL_MS
    );
  }

  #pause() {
    this.#stopPolling?.();
    this.#stopPolling = null;
    this.#baseline = null;
  }

  #openTasks() {
    return Object.values(this.#options.state().tasks).filter((task) => !isTaskSettled(task));
  }

  async #measure() {
    const disk = await this.#run(['df', '-k', '-P', this.#options.dataDir]);
    const free = disk.ok ? parseDiskFree(disk.stdout) : null;
    this.#disk = {
      at: this.#disk?.at ?? Number.NEGATIVE_INFINITY,
      disk: free,
      worktrees: this.#disk?.worktrees ?? new Map(),
    };
    const worktrees = new Map<string, number | null>();
    for (const task of this.#openTasks()) {
      if (!task.worktreePath) continue;
      const usage = await this.#run(['du', '-sk', task.worktreePath]);
      worktrees.set(task.id, parseDiskUsage(usage.stdout));
    }
    this.#disk = { at: this.#now(), disk: free, worktrees };
  }

  #isDiskStale() {
    const interval = this.#options.diskIntervalMs ?? DISK_INTERVAL_MS;
    return !this.#disk || this.#now() - this.#disk.at >= interval;
  }

  async #sample() {
    if (this.#isDiskStale()) void this.measureDisk();
    const table = await this.#run(PROCESS_TABLE);
    const memory = await this.#readMemory();
    const cpu = this.#readCpuTimes();
    const at = this.#now();
    const rows = table.ok ? parseProcessTable(table.stdout) : [];
    const baseline = this.#baseline;
    this.#baseline = { at, cpu, processes: new Map(rows.map((row) => [row.pid, row.cpuSeconds])) };
    if (!baseline || !memory || this.#listeners.size === 0) return;
    const cores = this.#options.cores ?? cpus().length;
    const capacitySeconds = ((at - baseline.at) / 1000) * cores;
    const use = resolveTaskUse(rows, this.#options.ledger.listRoots(), baseline.processes, capacitySeconds);
    const tasks = this.#openTasks().flatMap((task): TaskResources[] => {
      const found = use.get(task.id);
      const worktreeBytes = this.#disk?.worktrees.get(task.id) ?? null;
      if (!found && worktreeBytes === null) return [];
      const { agent, services, checks, processes } = found ?? createProcessUse();
      return [{ taskId: task.id, agent, services, checks, processes, worktreeBytes }];
    });
    this.#latest = {
      sampledAt: at,
      cores,
      cpuPercent: resolveCpuPercent(baseline.cpu, cpu),
      memoryUsedBytes: Math.min(memory.usedBytes, memory.totalBytes),
      memoryTotalBytes: memory.totalBytes,
      diskFreeBytes: this.#disk?.disk?.freeBytes ?? null,
      diskTotalBytes: this.#disk?.disk?.totalBytes ?? null,
      tasks: tasks.sort(compareTaskUse),
    };
    for (const listener of this.#listeners) listener(this.#latest);
  }
}
