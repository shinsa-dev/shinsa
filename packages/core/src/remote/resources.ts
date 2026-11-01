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

export interface MachineResources {
  sampledAt: number;
  cores: number;
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  tasks: TaskResources[];
}

export type ResourceSummary = Pick<
  MachineResources,
  'cores' | 'cpuPercent' | 'memoryUsedBytes' | 'memoryTotalBytes' | 'diskFreeBytes'
>;

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

function isCount(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum;
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function parseResourceSummary(value: unknown): ResourceSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const { cores, cpuPercent, memoryUsedBytes, memoryTotalBytes, diskFreeBytes } = value as Record<
    string,
    unknown
  >;
  if (!isCount(cores, 1) || !isAmount(cpuPercent) || cpuPercent > 100) return null;
  if (!isAmount(memoryUsedBytes) || !isAmount(memoryTotalBytes) || memoryUsedBytes > memoryTotalBytes)
    return null;
  if (diskFreeBytes !== null && !isAmount(diskFreeBytes)) return null;
  return { cores, cpuPercent, memoryUsedBytes, memoryTotalBytes, diskFreeBytes };
}
