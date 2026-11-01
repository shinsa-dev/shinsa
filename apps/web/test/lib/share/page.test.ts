import { describe, expect, it } from 'bun:test';
import type { Task } from '@shinsa/core';
import {
  describeOwnerPossessive,
  describeSharedBy,
  listSharedTabs,
  resolveOwnerName,
} from '@/lib/share/page.ts';
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
    expect(listSharedTabs(reviewed, createSharedTask({ preset: 'standard' }))).toEqual([
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

  it('names the owner by their login to anyone else, and as the owner when the share has no login', () => {
    expect(resolveOwnerName(createSharedTask(), null)).toBe('@mona');
    expect(resolveOwnerName(createSharedTask(), 'octocat')).toBe('@mona');
    expect(resolveOwnerName(createSharedTask({ owner: null }), 'mona')).toBe('The owner');
  });

  it('leaves the owner unnamed when the one looking is the owner, in any case', () => {
    expect(resolveOwnerName(createSharedTask(), 'mona')).toBeNull();
    expect(resolveOwnerName(createSharedTask(), 'MONA')).toBeNull();
  });

  it('makes the owner’s name possessive, and says your for the owner themselves', () => {
    expect(describeOwnerPossessive(null)).toBe('your');
    expect(describeOwnerPossessive('@mona')).toBe('@mona’s');
    expect(describeOwnerPossessive('The owner')).toBe('the owner’s');
  });
});
