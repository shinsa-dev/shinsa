import { describe, expect, it } from 'bun:test';
import { describeMachineResources, listResourceGauges, listTaskUseLines } from '@/lib/remote/resources.ts';
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

describe('a task’s use of its machine, shown on hover', () => {
  it('lists the agent, services, checks and worktree, calling an unused kind idle', () => {
    const resources = createMachineResources({
      tasks: [
        createTaskResources({ taskId: 'other', agent: { cpuPercent: 50, memoryBytes: GIGABYTE } }),
        createTaskResources({
          taskId: 't',
          agent: { cpuPercent: 4, memoryBytes: 0.5 * GIGABYTE },
          services: IDLE,
          checks: { cpuPercent: 30.4, memoryBytes: 1.2 * GIGABYTE },
        }),
      ],
    });
    expect(listTaskUseLines(resources, 't')).toEqual([
      { label: 'Agent', value: '4% · 0.5 GB' },
      { label: 'Services', value: 'Idle' },
      { label: 'Checks', value: '30% · 1.2 GB' },
      { label: 'Worktree', value: '2 GB' },
    ]);
  });

  it('leaves the worktree out before du measured it', () => {
    const resources = createMachineResources({
      tasks: [createTaskResources({ taskId: 't', worktreeBytes: null })],
    });
    expect(listTaskUseLines(resources, 't')?.map((line) => line.label)).toEqual([
      'Agent',
      'Services',
      'Checks',
    ]);
  });

  it('has nothing to show without a reading or for a task the machine does not report', () => {
    expect(listTaskUseLines(null, 't')).toBeNull();
    expect(listTaskUseLines(createMachineResources(), 't')).toBeNull();
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
