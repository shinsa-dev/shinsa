import { type Option, Schema } from 'effect';
import { ResourceSummary } from './schema.ts';

export interface ResourceUse {
  cpuPercent: number;
  memoryBytes: number;
}

export interface TaskResources {
  taskId: string;
  agent: ResourceUse;
  services: ResourceUse;
  checks: ResourceUse;
  processes: number;
  worktreeBytes: number | null;
}

export interface MachineResources extends ResourceSummary {
  sampledAt: number;
  diskTotalBytes: number | null;
  tasks: TaskResources[];
}

export const HEADROOM_STEP = 5;

const GIGABYTE = 1024 ** 3;

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function resolveMemoryPercent(
  resources: Pick<ResourceSummary, 'memoryUsedBytes' | 'memoryTotalBytes'>
) {
  if (resources.memoryTotalBytes <= 0) return 100;
  return clampPercent((resources.memoryUsedBytes / resources.memoryTotalBytes) * 100);
}

export function resolveResourceHeadroom(resources: ResourceSummary) {
  const freeCpu = 100 - clampPercent(resources.cpuPercent);
  const freeMemory = 100 - resolveMemoryPercent(resources);
  return Math.floor(Math.min(freeCpu, freeMemory) / HEADROOM_STEP) * HEADROOM_STEP;
}

export function resolveResourceSummary(resources: ResourceSummary): ResourceSummary {
  return {
    cores: resources.cores,
    cpuPercent: resources.cpuPercent,
    memoryUsedBytes: resources.memoryUsedBytes,
    memoryTotalBytes: resources.memoryTotalBytes,
    diskFreeBytes: resources.diskFreeBytes,
  };
}

export function describeGigabytes(bytes: number) {
  const gigabytes = bytes / GIGABYTE;
  return gigabytes >= 10 ? `${Math.round(gigabytes)}` : `${Math.round(gigabytes * 10) / 10}`;
}

export function describeResourceSummary(resources: ResourceSummary) {
  const cpu = `CPU ${Math.round(clampPercent(resources.cpuPercent))}% of ${resources.cores} cores`;
  const memory = `memory ${describeGigabytes(resources.memoryUsedBytes)} of ${describeGigabytes(resources.memoryTotalBytes)} GB used`;
  const disk =
    resources.diskFreeBytes === null ? null : `${describeGigabytes(resources.diskFreeBytes)} GB disk free`;
  return [cpu, memory, disk].filter((part) => part !== null).join(', ');
}

const decodeResourceSummary = Schema.decodeUnknownOption(ResourceSummary);

export function parseResourceSummary(value: unknown): Option.Option<ResourceSummary> {
  return decodeResourceSummary(value);
}
