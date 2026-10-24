import { describe, expect, it } from 'bun:test';
import type { TaskSuggestion } from '@shinsa/core';
import { listFollowUpStarts, listOpenSuggestions, resolveFollowUpStart } from '@/lib/tasks/suggestions.ts';
import { createTask } from '../../support/state.ts';

function suggestion(id: string, status: TaskSuggestion['status']): TaskSuggestion {
  return {
    id,
    runId: null,
    title: id,
    intent: id,
    why: id,
    waitsOnThis: false,
    status,
    createdTaskId: null,
    suggestedAt: 1,
  };
}

describe('listOpenSuggestions', () => {
  it('keeps the ones still waiting on you', () => {
    const task = createTask({ id: 't', suggestions: [suggestion('a', 'open'), suggestion('b', 'accepted')] });
    expect(listOpenSuggestions(task).map((entry) => entry.id)).toEqual(['a']);
    expect(listOpenSuggestions(createTask({ id: 't' }))).toEqual([]);
  });
});

describe('when a follow-up starts', () => {
  it('defaults to what the agent suggested and lists that choice first, marked as suggested', () => {
    const waits = { ...suggestion('a', 'open'), waitsOnThis: true };
    expect(resolveFollowUpStart(waits)).toBe('after');
    expect(listFollowUpStarts(waits)).toEqual([
      { value: 'after', label: 'After this task merges', icon: 'IconHourglass', hint: 'Suggested' },
      { value: 'now', label: 'Start now', icon: 'IconRocket' },
    ]);
    const now = suggestion('b', 'open');
    expect(resolveFollowUpStart(now)).toBe('now');
    expect(listFollowUpStarts(now)).toEqual([
      { value: 'now', label: 'Start now', icon: 'IconRocket', hint: 'Suggested' },
      { value: 'after', label: 'After this task merges', icon: 'IconHourglass' },
    ]);
  });
});
