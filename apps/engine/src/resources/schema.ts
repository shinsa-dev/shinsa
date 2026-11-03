import type { MachineResources, ResourceUse, ShinsaState } from '@shinsa/core';
import { Duration } from 'effect';
import type { Argv, CommandResult } from '../shell/schema.ts';

type ProcessKind = 'agent' | 'services' | 'checks';

export interface ProcessRoot {
  taskId: string;
  kind: ProcessKind;
  pid: number;
}

export interface ServiceProcess {
  taskId: string;
  pid: number;
}

export type ProcessTracker = (taskId: string, kind: ProcessKind, pid: number) => () => void;

export interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
  memoryBytes: number;
  cpuSeconds: number;
}

export interface ProcessUse extends Record<ProcessKind, ResourceUse> {
  processes: number;
}

export interface CpuTimes {
  busy: number;
  total: number;
}

export interface MemoryReading {
  usedBytes: number;
  totalBytes: number;
}

export interface DiskReading {
  freeBytes: number;
  totalBytes: number;
}

export interface DiskSample {
  at: number;
  disk: DiskReading | null;
  worktrees: Map<string, number | null>;
}

export interface Baseline {
  at: number;
  cpu: CpuTimes;
  processes: Map<number, number>;
}

export type ResourceListener = (resources: MachineResources) => void;

export type ResourceCommand = (argv: string[]) => Promise<CommandResult>;

export interface ResourceMonitorOptions {
  ledger: { listRoots(): ProcessRoot[] };
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

const RESOURCE_INTERVAL = Duration.seconds(5);

export const RESOURCE_INTERVAL_MS = Duration.toMillis(RESOURCE_INTERVAL);

const PRIME_DELAY = Duration.seconds(1);

export const PRIME_DELAY_MS = Duration.toMillis(PRIME_DELAY);

const DISK_INTERVAL = Duration.minutes(10);

export const DISK_INTERVAL_MS = Duration.toMillis(DISK_INTERVAL);

const RESOURCE_COMMAND_TIMEOUT = Duration.minutes(1);

export const RESOURCE_COMMAND_TIMEOUT_MS = Duration.toMillis(RESOURCE_COMMAND_TIMEOUT);

export const PROCESS_TABLE: Argv = ['ps', '-A', '-o', 'pid=,ppid=,pgid=,rss=,time='];

export const KILOBYTE = 1024;

export const MEMINFO_PATH = '/proc/meminfo';
