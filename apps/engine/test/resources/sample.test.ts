import { describe, expect, test } from 'bun:test';
import {
  parseCpuTime,
  parseDiskFree,
  parseDiskUsage,
  parseMemInfo,
  parseProcessTable,
  parseVmStat,
  resolveCpuPercent,
  resolveProcessOwners,
  resolveTaskUse,
} from '../../src/resources/sample.ts';

const TABLE = [
  '    1     0     1  23104 144:26.60',
  '  100     1   100  10240   0:10.00',
  '  101   100   100   2048   0:02.50',
  '  102   101   102   1024   0:01.00',
  '  200     1   100   4096   0:04.00',
  '  300     1   300   8192 1-00:00:01',
  'garbage line',
  '    0     0     0      0   0:00.00',
  '  400     1   400     -1   0:00.00',
].join('\n');

describe('parsing a process table', () => {
  test('reads macOS and Linux cpu times', () => {
    expect(parseCpuTime('144:26.60')).toBeCloseTo(8666.6);
    expect(parseCpuTime('01:02:03')).toBe(3723);
    expect(parseCpuTime('2-01:00:00')).toBe(2 * 86_400 + 3600);
    expect(parseCpuTime('')).toBe(0);
    expect(parseCpuTime('a:b')).toBeNull();
  });

  test('keeps whole rows in bytes and skips lines it cannot read', () => {
    const rows = parseProcessTable(TABLE);
    expect(rows.map((row) => row.pid)).toEqual([1, 100, 101, 102, 200, 300]);
    expect(rows[1]).toEqual({ pid: 100, ppid: 1, pgid: 100, memoryBytes: 10240 * 1024, cpuSeconds: 10 });
    expect(rows.at(-1)?.cpuSeconds).toBe(86_401);
  });
});

describe('counting processes toward their task', () => {
  const rows = parseProcessTable(TABLE);
  const roots = [
    { taskId: 'task-a', kind: 'agent' as const, pid: 100 },
    { taskId: 'task-b', kind: 'checks' as const, pid: 102 },
  ];

  test('a process belongs to its nearest tracked ancestor, then to its process group', () => {
    const owners = resolveProcessOwners(rows, roots);
    expect(owners.get(100)?.taskId).toBe('task-a');
    expect(owners.get(101)?.taskId).toBe('task-a');
    expect(owners.get(102)?.taskId).toBe('task-b');
    expect(owners.get(200)?.taskId).toBe('task-a');
    expect(owners.has(1)).toBe(false);
    expect(owners.has(300)).toBe(false);
  });

  test('a loop in the parent links ends the walk', () => {
    const looped = [
      { pid: 5, ppid: 6, pgid: 5, memoryBytes: 0, cpuSeconds: 0 },
      { pid: 6, ppid: 5, pgid: 6, memoryBytes: 0, cpuSeconds: 0 },
    ];
    expect(resolveProcessOwners(looped, roots).size).toBe(0);
  });

  test('sums memory and the cpu time since the last sample as a share of the machine', () => {
    const previous = new Map([
      [100, 9],
      [101, 2.5],
      [200, 5],
    ]);
    const use = resolveTaskUse(rows, roots, previous, 10);
    expect(use.get('task-a')).toEqual({
      agent: { cpuPercent: 10, memoryBytes: (10240 + 2048 + 4096) * 1024 },
      services: { cpuPercent: 0, memoryBytes: 0 },
      checks: { cpuPercent: 0, memoryBytes: 0 },
      processes: 3,
    });
    expect(use.get('task-b')?.checks).toEqual({ cpuPercent: 10, memoryBytes: 1024 * 1024 });
  });

  test('reports no cpu without an earlier sample or any time passed', () => {
    expect(resolveTaskUse(rows, roots, null, 10).get('task-a')?.agent.cpuPercent).toBe(0);
    expect(resolveTaskUse(rows, roots, new Map(), 0).get('task-a')?.agent.cpuPercent).toBe(0);
    expect(resolveTaskUse(rows, roots, new Map(), 1).get('task-a')?.agent.cpuPercent).toBe(100);
  });
});

describe('reading the machine', () => {
  test('cpu use is the busy share of the time between two readings', () => {
    expect(resolveCpuPercent(null, { busy: 5, total: 10 })).toBe(0);
    expect(resolveCpuPercent({ busy: 0, total: 0 }, { busy: 5, total: 20 })).toBe(25);
    expect(resolveCpuPercent({ busy: 5, total: 20 }, { busy: 5, total: 20 })).toBe(0);
  });

  test('Linux memory in use is the total less what is available', () => {
    const text = 'MemTotal:       32000000 kB\nMemFree:  1000 kB\nMemAvailable:   20000000 kB\n';
    expect(parseMemInfo(text)).toEqual({ usedBytes: 12_000_000 * 1024, totalBytes: 32_000_000 * 1024 });
    expect(parseMemInfo('MemTotal: 1 kB\n')).toBeNull();
  });

  test('macOS memory in use leaves out free, inactive and speculative pages', () => {
    const text = [
      'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
      'Pages free:                                   100.',
      'Pages inactive:                               200.',
      'Pages speculative:                             50.',
    ].join('\n');
    expect(parseVmStat(text, 16384 * 1000)).toEqual({ usedBytes: 16384 * 650, totalBytes: 16384 * 1000 });
    expect(parseVmStat('Pages free: 1.', 1)).toBeNull();
    expect(parseVmStat('(page size of 4096 bytes)', 4096)).toEqual({ usedBytes: 4096, totalBytes: 4096 });
  });

  test('reads the disk from df and a folder from du', () => {
    const df = [
      'Filesystem 1024-blocks Used Available Capacity Mounted on',
      '/dev/disk3s1s1 1000 400 600 40% /',
    ].join('\n');
    expect(parseDiskFree(df)).toEqual({ freeBytes: 600 * 1024, totalBytes: 1000 * 1024 });
    expect(parseDiskFree('nothing')).toBeNull();
    expect(parseDiskFree('')).toBeNull();
    expect(parseDiskUsage('2048\t/wt/a\n')).toBe(2048 * 1024);
    expect(parseDiskUsage('')).toBeNull();
    expect(parseDiskUsage('du: cannot read')).toBeNull();
  });
});
