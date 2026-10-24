import { describe, expect, it } from 'bun:test';
import type { TaskRefs } from '@shinsa/core';
import { formatSha, listRefChoices, resolveViewRef } from '@/lib/code/refs.ts';

const HEAD = 'h'.repeat(40);
const BASE = 'b'.repeat(40);
const FIRST = '1'.repeat(40);

const REFS: TaskRefs = {
  head: HEAD,
  base: BASE,
  branch: 'feat/x',
  defaultBranch: 'main',
  working: true,
  dirty: true,
  commits: [
    { sha: FIRST, subject: 'feat: phase one', at: 1 },
    { sha: HEAD, subject: 'feat: phase two', at: 2 },
  ],
};

describe('resolveViewRef', () => {
  it('reads a commit the task knows or the working copy, and the head otherwise', () => {
    expect(resolveViewRef(null, REFS)).toBe(HEAD);
    expect(resolveViewRef(FIRST, REFS)).toBe(FIRST);
    expect(resolveViewRef(BASE, REFS)).toBe(BASE);
    expect(resolveViewRef('working', REFS)).toBe('working');
    expect(resolveViewRef('working', { ...REFS, working: false })).toBe(HEAD);
    expect(resolveViewRef('f'.repeat(40), REFS)).toBe(HEAD);
  });
});

describe('listRefChoices', () => {
  it('offers the head, the working copy, the base and each earlier commit, newest first', () => {
    expect(listRefChoices(REFS).map((choice) => [choice.label, choice.hint, choice.group])).toEqual([
      ['Head of the branch', 'hhhhhhh', 'Branch'],
      ['Working copy', 'Uncommitted edits', 'Branch'],
      ['Base', 'bbbbbbb', 'Branch'],
      ['feat: phase one', '1111111', 'Commits'],
    ]);
  });

  it('names the default branch for a task without one, and leaves out what it lacks', () => {
    const bare = { ...REFS, branch: null, base: null, working: false, commits: [] };
    expect(listRefChoices(bare).map((choice) => choice.label)).toEqual(['main']);
    expect(listRefChoices({ ...REFS, dirty: false })[1]?.hint).toBe('No uncommitted edits');
    expect(formatSha(HEAD)).toBe('hhhhhhh');
  });
});
