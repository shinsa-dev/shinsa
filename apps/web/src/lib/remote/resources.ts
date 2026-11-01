import {
  describeGigabytes,
  type MachineResources,
  type ResourceUse,
  resolveMemoryPercent,
} from '@shinsa/core';
import { resolveUsageTone } from '@/lib/accounts/usage.ts';
import type { Tone } from '@/lib/format/tone.ts';

export const NO_RESOURCE_READING = 'No reading yet.';

function describePercent(value: number) {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`;
}

export function describeMachineResources(
  resources: Pick<MachineResources, 'cpuPercent' | 'memoryUsedBytes' | 'memoryTotalBytes' | 'diskFreeBytes'>
) {
  const parts = [
    `CPU ${describePercent(resources.cpuPercent)}`,
    `Memory ${describeGigabytes(resources.memoryUsedBytes)} of ${describeGigabytes(resources.memoryTotalBytes)} GB`,
  ];
  if (resources.diskFreeBytes !== null) parts.push(`${describeGigabytes(resources.diskFreeBytes)} GB free`);
  return parts.join(' · ');
}

const IDLE_USE = 'Idle';

function describeUse(use: ResourceUse) {
  if (use.cpuPercent <= 0 && use.memoryBytes <= 0) return IDLE_USE;
  return `${describePercent(use.cpuPercent)} · ${describeGigabytes(use.memoryBytes)} GB`;
}

export interface TaskUseLine {
  label: string;
  value: string;
}

export function listTaskUseLines(
  resources: MachineResources | null | undefined,
  taskId: string
): TaskUseLine[] | null {
  const entry = resources?.tasks.find((candidate) => candidate.taskId === taskId);
  if (!entry) return null;
  const lines = [
    { label: 'Agent', value: describeUse(entry.agent) },
    { label: 'Services', value: describeUse(entry.services) },
    { label: 'Checks', value: describeUse(entry.checks) },
  ];
  if (entry.worktreeBytes === null) return lines;
  return [...lines, { label: 'Worktree', value: `${describeGigabytes(entry.worktreeBytes)} GB` }];
}

export interface ResourceGauge {
  id: 'cpu' | 'memory' | 'disk';
  label: string;
  percent: number | null;
  tone: Tone;
  value: string;
}

function createGauge(id: ResourceGauge['id'], label: string, percent: number | null, value: string) {
  const rounded = percent === null ? null : Math.round(Math.min(100, Math.max(0, percent)));
  return { id, label, percent: rounded, tone: resolveUsageTone(rounded ?? 0), value };
}

export function listResourceGauges(resources: MachineResources): ResourceGauge[] {
  const gauges = [
    createGauge('cpu', 'CPU', resources.cpuPercent, describePercent(resources.cpuPercent)),
    createGauge(
      'memory',
      'Memory',
      resolveMemoryPercent(resources),
      `${describeGigabytes(resources.memoryUsedBytes)} of ${describeGigabytes(resources.memoryTotalBytes)} GB`
    ),
  ];
  if (resources.diskFreeBytes === null) return gauges;
  const total = resources.diskTotalBytes;
  const used = total && total > 0 ? ((total - resources.diskFreeBytes) / total) * 100 : null;
  return [
    ...gauges,
    createGauge('disk', 'Disk', used, `${describeGigabytes(resources.diskFreeBytes)} GB free`),
  ];
}
