import { describe, expect, it } from 'bun:test';
import type { MachineChoice } from '@/lib/connection/socket.ts';
import {
  describeMachineResources,
  describeTaskUse,
  IDLE_TASK_USE,
  listMachineResourceRows,
  listTaskResourceRows,
  NO_RESOURCE_READING,
} from '@/lib/remote/resources.ts';
import { createMachineResources, createTaskResources } from '../../support/resources.ts';

const GIGABYTE = 1024 ** 3;
const IDLE = { cpuPercent: 0, memoryBytes: 0 };

function createChoice(overrides: Partial<MachineChoice> = {}): MachineChoice {
  return {
    id: 'studio',
    name: 'Studio',
    current: true,
    state: {
      tasks: { a: { stage: 'building' }, b: { stage: 'merged' } },
      projects: {},
      settings: { taskCapacity: 4 },
    },
    ...overrides,
  };
}

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

describe('the rows of the Machines card', () => {
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

  it('gives each machine its use, its open tasks against its capacity and its tasks', () => {
    const reported = createChoice({
      resources: createMachineResources({ tasks: [createTaskResources({ taskId: 'busy' })] }),
    });
    const silent = createChoice({ id: 'box', name: 'Build box', resources: null });
    expect(listMachineResourceRows([reported, silent], tasks)).toEqual([
      {
        id: 'studio',
        name: 'Studio',
        use: 'CPU 20% · Memory 8 of 32 GB · 120 GB free',
        load: '1 of 4 open tasks',
        tasks: [{ task: tasks.busy, use: 'Agent 4%, 0.5 GB', worktree: '2 GB worktree' }],
      },
      { id: 'box', name: 'Build box', use: NO_RESOURCE_READING, load: '1 of 4 open tasks', tasks: [] },
    ]);
  });
});
