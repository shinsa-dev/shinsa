import { describe, expect, it } from 'bun:test';
import type { Task } from '@shinsa/core';
import { describeSharedBy, listSharedTabs } from '@/lib/share/page.ts';
import { createTask } from '../../support/state.ts';
import { createSharedTask } from './fixtures.ts';

function createReport() {
  return { headline: '', sections: [], checks: [], judgementCalls: [] } as unknown as NonNullable<
    Task['report']
  >;
}

describe('the shared page', () => {
  it('has the owner’s tabs, without Chat when the share sends no live output, and Code only when it is shared', () => {
    const reviewed = createTask({ id: 't', repoId: 'r', stage: 'awaiting_review', report: createReport() });
    const status = { preset: 'status' } as const;
    expect(listSharedTabs(reviewed, createSharedTask(status))).toEqual(['overview', 'review', 'code']);
    expect(listSharedTabs(reviewed, createSharedTask({ ...status, code: false }))).toEqual([
      'overview',
      'review',
    ]);
    const planning = createTask({ id: 't', stage: 'planning' });
    expect(listSharedTabs(planning, createSharedTask({ ...status, code: false }))).toEqual(['overview']);
  });

  it('has Chat when the share sends the agents’ live output, as Default does', () => {
    const reviewed = createTask({ id: 't', repoId: 'r', stage: 'awaiting_review', report: createReport() });
    expect(listSharedTabs(reviewed, createSharedTask({ preset: 'default' }))).toEqual([
      'overview',
      'review',
      'code',
      'chat',
    ]);
  });

  it('says who shared it and from which machine, with what it knows', () => {
    expect(describeSharedBy(createSharedTask(), null)).toBe('Shared by @mona from Studio');
    expect(describeSharedBy(createSharedTask({ machine: null }), 'octocat')).toBe('Shared by @mona');
    expect(describeSharedBy(createSharedTask({ owner: null }), null)).toBe('Shared from Studio');
    expect(describeSharedBy(createSharedTask({ owner: null, machine: null }), 'mona')).toBe('Shared');
  });

  it('says you shared it when the one looking is its owner, without the @', () => {
    expect(describeSharedBy(createSharedTask(), 'mona')).toBe('Shared by you from Studio');
    expect(describeSharedBy(createSharedTask({ machine: null }), 'Mona')).toBe('Shared by you');
  });
});
