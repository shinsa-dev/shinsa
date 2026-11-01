import { describe, expect, it } from 'bun:test';
import {
  describeMachineResources,
  describeTaskUse,
  IDLE_TASK_USE,
  listResourceGauges,
  listTaskResourceRows,
} from '@/lib/remote/resources.ts';
import { createMachineResources, createTaskResources } from '../../support/resources.ts';

const GIGABYTE = 1024 ** 3;
const IDLE = { cpuPercent: 0, memoryBytes: 0 };

describe('a machine’s resource use in words', () => {
  it('says CPU, memory and free disk, rounding to whole percents and gigabytes', () => {
    expect(
      describeMachineResources(createMachineResources({ cpuPercent: 41.6, memoryUsedBytes: 12.2 * GIGABYTE }))
    ).toBe('CPU 42% · Memory 12 of 32 GB · 120 GB free');
  });

  it('leaves the disk out when the engine could not read it, and keeps CPU within 0 to 100', () => {
    expect(describeMachineResources(createMachineResources({ cpuPercent: 104, diskFreeBytes: null }))).toBe(
      'CPU 100% · Memory 8 of 32 GB'
    );
  });
});

describe('a task’s resource use in words', () => {
  it('names each kind of process that uses something and leaves idle ones out', () => {
    expect(
      describeTaskUse(
        createTaskResources({
          taskId: 't',
          agent: { cpuPercent: 4, memoryBytes: 0.5 * GIGABYTE },
          services: IDLE,
          checks: { cpuPercent: 30.4, memoryBytes: 1.2 * GIGABYTE },
        })
      )
    ).toBe('Agent 4%, 0.5 GB · Checks 30%, 1.2 GB');
  });

  it('says no process runs when nothing does', () => {
    expect(describeTaskUse(createTaskResources({ taskId: 't', agent: IDLE }))).toBe(IDLE_TASK_USE);
  });
});

describe('a machine’s open tasks by use', () => {
  const tasks = { quiet: { id: 'quiet', title: 'Quiet' }, busy: { id: 'busy', title: 'Busy' } };

  it('lists the busiest task first and skips a task the page does not know', () => {
    const resources = createMachineResources({
      tasks: [
        createTaskResources({ taskId: 'quiet', agent: { cpuPercent: 1, memoryBytes: GIGABYTE } }),
        createTaskResources({ taskId: 'busy', agent: { cpuPercent: 9, memoryBytes: GIGABYTE } }),
        createTaskResources({ taskId: 'gone' }),
        createTaskResources({
          taskId: 'quiet',
          agent: { cpuPercent: 1, memoryBytes: 3 * GIGABYTE },
          worktreeBytes: null,
        }),
      ],
    });
    expect(listTaskResourceRows(resources, tasks)).toEqual([
      { task: tasks.busy, use: 'Agent 9%, 1 GB', worktree: '2 GB worktree' },
      { task: tasks.quiet, use: 'Agent 1%, 3 GB', worktree: null },
      { task: tasks.quiet, use: 'Agent 1%, 1 GB', worktree: '2 GB worktree' },
    ]);
  });
});

describe('the meters of a machine in Settings', () => {
  it('shows CPU, memory and disk with how full each is, toned as it fills', () => {
    expect(
      listResourceGauges(
        createMachineResources({
          cpuPercent: 91.4,
          memoryUsedBytes: 8 * GIGABYTE,
          diskFreeBytes: 120 * GIGABYTE,
          diskTotalBytes: 1000 * GIGABYTE,
        })
      )
    ).toEqual([
      { id: 'cpu', label: 'CPU', percent: 91, tone: 'red', value: '91%' },
      { id: 'memory', label: 'Memory', percent: 25, tone: 'neutral', value: '8 of 32 GB' },
      { id: 'disk', label: 'Disk', percent: 88, tone: 'amber', value: '120 GB free' },
    ]);
  });

  it('shows free disk without a meter when the total is unknown, and no disk when nothing was read', () => {
    expect(listResourceGauges(createMachineResources({ diskTotalBytes: null }))[2]).toMatchObject({
      percent: null,
      value: '120 GB free',
    });
    expect(listResourceGauges(createMachineResources({ diskFreeBytes: null }))).toHaveLength(2);
  });
});
