import { cpus, freemem, totalmem } from 'node:os';
import { isTaskSettled, type MachineResources, type ShinsaState, type TaskResources } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import { type CommandResult, runCommand } from '../shell/index.ts';
import type { ProcessLedger } from './ledger.ts';
import {
  type CpuTimes,
  createProcessUse,
  type DiskReading,
  type MemoryReading,
  parseDiskFree,
  parseDiskUsage,
  parseMemInfo,
  parseProcessTable,
  parseVmStat,
  resolveCpuPercent,
  resolveTaskUse,
} from './sample.ts';

export { ProcessLedger, type ProcessTracker } from './ledger.ts';

type ResourceListener = (resources: MachineResources) => void;

export type ResourceCommand = (argv: string[]) => Promise<CommandResult>;

export interface ResourceMonitorOptions {
  ledger: ProcessLedger;
  state: () => Pick<ShinsaState, 'tasks'>;
  dataDir: string;
  run?: ResourceCommand;
  readCpuTimes?: () => CpuTimes;
  readMemory?: () => Promise<MemoryReading | null>;
  cores?: number;
  now?: () => number;
  intervalMs?: number;
  primeMs?: number;
  diskIntervalMs?: number;
}

interface DiskSample {
  at: number;
  disk: DiskReading | null;
  worktrees: Map<string, number | null>;
}

interface Baseline {
  at: number;
  cpu: CpuTimes;
  processes: Map<number, number>;
}

const RESOURCE_INTERVAL_MS = 5_000;
const PRIME_MS = 1_000;
const DISK_INTERVAL_MS = 10 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 60_000;
const PROCESS_TABLE = ['ps', '-A', '-o', 'pid=,ppid=,pgid=,rss=,time='];

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
    if (platform === 'linux') return parseMemInfo(await readText('/proc/meminfo'));
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
  #timer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0;
  #stopped = false;

  constructor(options: ResourceMonitorOptions) {
    this.#options = options;
    this.#run =
      options.run ?? ((argv) => runCommand(argv, options.dataDir, { timeoutMs: COMMAND_TIMEOUT_MS }));
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
    this.#schedule(this.#options.primeMs ?? PRIME_MS);
  }

  #pause() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#generation += 1;
    this.#baseline = null;
  }

  #schedule(delayMs: number) {
    const generation = this.#generation;
    this.#timer = setTimeout(() => {
      void this.refresh().then(() => {
        if (generation === this.#generation) this.#schedule(this.#options.intervalMs ?? RESOURCE_INTERVAL_MS);
      });
    }, delayMs);
  }

  #openTasks() {
    return Object.values(this.#options.state().tasks).filter((task) => !isTaskSettled(task));
  }

  async #measure() {
    const disk = await this.#run(['df', '-k', '-P', this.#options.dataDir]);
    const worktrees = new Map<string, number | null>();
    for (const task of this.#openTasks()) {
      if (!task.worktreePath) continue;
      const usage = await this.#run(['du', '-sk', task.worktreePath]);
      worktrees.set(task.id, parseDiskUsage(usage.stdout));
    }
    this.#disk = { at: this.#now(), disk: disk.ok ? parseDiskFree(disk.stdout) : null, worktrees };
  }

  #isDiskStale() {
    const interval = this.#options.diskIntervalMs ?? DISK_INTERVAL_MS;
    return !this.#disk || this.#now() - this.#disk.at >= interval;
  }

  async #sample() {
    if (!this.#disk) await this.measureDisk();
    else if (this.#isDiskStale()) void this.measureDisk();
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
