import { describe, expect, it } from 'bun:test';
import { describeSharedBy, listSharedTabs, resolveSharedTab } from '@/lib/share/page.ts';
import type { Task } from '@shinsa/core';
import { createTask } from '../../support/state.ts';
import { createSharedTask } from './fixtures.ts';

function createReport() {
  return { headline: '', sections: [], checks: [], judgementCalls: [] } as unknown as NonNullable<Task['report']>;
}

describe('the shared page', () => {
  it('shows the review once there is a report, and the code only when it is shared', () => {
    const reviewed = createTask({ id: 't', stage: 'awaiting_review', report: createReport() });
    expect(listSharedTabs(reviewed, createSharedTask())).toEqual(['overview', 'review', 'code']);
    expect(listSharedTabs(reviewed, createSharedTask({ code: false }))).toEqual(['overview', 'review']);
    const planning = createTask({ id: 't', stage: 'planning' });
    expect(listSharedTabs(planning, createSharedTask({ code: false }))).toEqual(['overview']);
  });

  it('leaves out a review with no report when no code is shared to build one from', () => {
    const reviewing = createTask({ id: 't', stage: 'awaiting_review', report: null });
    expect(listSharedTabs(reviewing, createSharedTask({ code: false }))).toEqual(['overview']);
    expect(listSharedTabs(reviewing, createSharedTask())).toEqual(['overview', 'review', 'code']);
  });

  it('opens on the tab asked for when it exists, and the overview otherwise', () => {
    expect(resolveSharedTab(['overview', 'review'], 'review')).toBe('review');
    expect(resolveSharedTab(['overview', 'review'], 'code')).toBe('overview');
    expect(resolveSharedTab(['overview'], null)).toBe('overview');
  });

  it('says who shared it and from which machine, with what it knows', () => {
    expect(describeSharedBy(createSharedTask())).toBe('Shared by @mona from Studio');
    expect(describeSharedBy(createSharedTask({ machine: null }))).toBe('Shared by @mona');
    expect(describeSharedBy(createSharedTask({ owner: null }))).toBe('Shared from Studio');
    expect(describeSharedBy(createSharedTask({ owner: null, machine: null }))).toBe('Shared');
  });
});
