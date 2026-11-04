import type { MachineResources, ResourceUse } from '@shinsa/core';
import { Context, Duration } from 'effect';
import type { Effect } from 'effect';
import type { Argv } from '../shell/schema.ts';

type ProcessKind = 'agent' | 'services' | 'checks';

export interface ProcessRoot {
  taskId: string;
  kind: ProcessKind;
  pid: number;
}

export type ProcessTracker = (
  taskId: string,
  kind: ProcessKind,
  pid: number
) => Effect.Effect<Effect.Effect<void>>;

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

export interface ResourceTimingsShape {
  readonly interval: Duration.Duration;
  readonly prime: Duration.Duration;
  readonly diskInterval: Duration.Duration;
}

export const ResourceTimings = Context.Reference<ResourceTimingsShape>(
  'shinsa/engine/resources/ResourceTimings',
  {
    defaultValue: () => ({
      interval: Duration.seconds(5),
      prime: Duration.seconds(1),
      diskInterval: Duration.minutes(10),
    }),
  }
);

export const RESOURCE_COMMAND_TIMEOUT = Duration.minutes(1);

export const PROCESS_TABLE: Argv = ['ps', '-A', '-o', 'pid=,ppid=,pgid=,rss=,time='];

export const KILOBYTE = 1024;

export const MEMINFO_PATH = '/proc/meminfo';
