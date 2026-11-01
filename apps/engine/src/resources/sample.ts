import type { ResourceUse } from '@shinsa/core';
import type { ProcessKind, ProcessRoot } from './ledger.ts';

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

const KILOBYTE = 1024;

export function parseCpuTime(text: string) {
  const [days, clock] = text.includes('-') ? text.split('-') : ['0', text];
  const parts = (clock ?? '').split(':').map(Number);
  if (parts.length === 0 || parts.some((part) => Number.isNaN(part))) return null;
  const seconds = parts.reduceRight(
    (total, part, index) => total + part * 60 ** (parts.length - 1 - index),
    0
  );
  return Number(days) * 86_400 + seconds;
}

export function parseProcessTable(table: string): ProcessRow[] {
  return table.split('\n').flatMap((line) => {
    const [pid, ppid, pgid, rss, time] = line.trim().split(/\s+/);
    const cpuSeconds = parseCpuTime(time ?? '');
    const numbers = [pid, ppid, pgid, rss].map(Number);
    if (cpuSeconds === null || numbers.some((value) => !Number.isInteger(value) || value < 0)) return [];
    const [pidNumber = 0, ppidNumber = 0, pgidNumber = 0, rssKilobytes = 0] = numbers;
    if (pidNumber === 0) return [];
    return [
      {
        pid: pidNumber,
        ppid: ppidNumber,
        pgid: pgidNumber,
        memoryBytes: rssKilobytes * KILOBYTE,
        cpuSeconds,
      },
    ];
  });
}

export function resolveProcessOwners(rows: readonly ProcessRow[], roots: readonly ProcessRoot[]) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const rootByPid = new Map(roots.map((root) => [root.pid, root]));
  const owners = new Map<number, ProcessRoot>();
  const resolveOwner = (row: ProcessRow) => {
    const seen = new Set<number>();
    for (let current: ProcessRow | undefined = row; current; current = byPid.get(current.ppid)) {
      if (seen.has(current.pid)) break;
      seen.add(current.pid);
      const root = rootByPid.get(current.pid);
      if (root) return root;
    }
    return rootByPid.get(row.pgid) ?? null;
  };
  for (const row of rows) {
    const owner = resolveOwner(row);
    if (owner) owners.set(row.pid, owner);
  }
  return owners;
}

function resolveCpuSeconds(row: ProcessRow, previous: ReadonlyMap<number, number> | null) {
  if (!previous) return 0;
  const before = previous.get(row.pid);
  if (before === undefined) return row.cpuSeconds;
  return Math.max(0, row.cpuSeconds - before);
}

export function createProcessUse(): ProcessUse {
  return {
    agent: { cpuPercent: 0, memoryBytes: 0 },
    services: { cpuPercent: 0, memoryBytes: 0 },
    checks: { cpuPercent: 0, memoryBytes: 0 },
    processes: 0,
  };
}

export function resolveTaskUse(
  rows: readonly ProcessRow[],
  roots: readonly ProcessRoot[],
  previous: ReadonlyMap<number, number> | null,
  capacitySeconds: number
) {
  const owners = resolveProcessOwners(rows, roots);
  const byTask = new Map<string, ProcessUse>();
  for (const row of rows) {
    const owner = owners.get(row.pid);
    if (!owner) continue;
    const use = byTask.get(owner.taskId) ?? createProcessUse();
    const share = capacitySeconds > 0 ? (resolveCpuSeconds(row, previous) / capacitySeconds) * 100 : 0;
    use[owner.kind].cpuPercent = Math.min(100, use[owner.kind].cpuPercent + share);
    use[owner.kind].memoryBytes += row.memoryBytes;
    use.processes += 1;
    byTask.set(owner.taskId, use);
  }
  return byTask;
}

export function resolveCpuPercent(before: CpuTimes | null, after: CpuTimes) {
  if (!before) return 0;
  const total = after.total - before.total;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, ((after.busy - before.busy) / total) * 100));
}

export function parseMemInfo(text: string): MemoryReading | null {
  const fields = new Map(
    text.split('\n').flatMap((line) => {
      const match = /^(\w+):\s+(\d+)\s*kB/.exec(line);
      return match?.[1] && match[2] ? [[match[1], Number(match[2]) * KILOBYTE] as const] : [];
    })
  );
  const total = fields.get('MemTotal');
  const available = fields.get('MemAvailable');
  if (total === undefined || available === undefined) return null;
  return { usedBytes: Math.max(0, total - available), totalBytes: total };
}

export function parseVmStat(text: string, totalBytes: number): MemoryReading | null {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  if (!pageSize) return null;
  const pages = (name: string) => Number(new RegExp(`^Pages ${name}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0);
  const available = (pages('free') + pages('inactive') + pages('speculative')) * pageSize;
  return { usedBytes: Math.max(0, totalBytes - available), totalBytes };
}

export function parseDiskFree(text: string): DiskReading | null {
  const line = text.trim().split('\n').at(-1) ?? '';
  const [, total, , available] = line.trim().split(/\s+/).map(Number);
  if (total === undefined || available === undefined || Number.isNaN(total) || Number.isNaN(available))
    return null;
  return { freeBytes: available * KILOBYTE, totalBytes: total * KILOBYTE };
}

export function parseDiskUsage(text: string) {
  const kilobytes = Number(text.trim().split(/\s+/)[0]);
  return Number.isInteger(kilobytes) && kilobytes >= 0 && text.trim() !== '' ? kilobytes * KILOBYTE : null;
}
