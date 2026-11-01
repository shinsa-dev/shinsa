import type { MachineResources, TaskResources } from '@shinsa/core';
import { NOW } from './state.ts';

const GIGABYTE = 1024 ** 3;

export function createTaskResources(overrides: Partial<TaskResources> & { taskId: string }): TaskResources {
  return {
    agent: { cpuPercent: 4, memoryBytes: 0.5 * GIGABYTE },
    services: { cpuPercent: 0, memoryBytes: 0 },
    checks: { cpuPercent: 0, memoryBytes: 0 },
    processes: 3,
    worktreeBytes: 2 * GIGABYTE,
    ...overrides,
  };
}

export function createMachineResources(overrides: Partial<MachineResources> = {}): MachineResources {
  return {
    sampledAt: NOW,
    cores: 8,
    cpuPercent: 20,
    memoryUsedBytes: 8 * GIGABYTE,
    memoryTotalBytes: 32 * GIGABYTE,
    diskFreeBytes: 120 * GIGABYTE,
    diskTotalBytes: 500 * GIGABYTE,
    tasks: [],
    ...overrides,
  };
}
