import { describe, expect, it } from 'bun:test';
import type { TaskSuggestion } from '@shinsa/core';
import {
  listOpenSuggestions,
  listSuggestionStarts,
  resolveSuggestionStart,
} from '@/lib/tasks/suggestions.ts';
import { createTask } from '../../support/state.ts';

function suggestion(id: string, status: TaskSuggestion['status']): TaskSuggestion {
  return {
    id,
    runId: null,
    title: id,
    request: id,
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
    expect(resolveSuggestionStart(waits)).toBe('after');
    expect(listSuggestionStarts(waits)).toEqual([
      { value: 'after', label: 'After this task merges', icon: 'IconHourglass', hint: 'Suggested' },
      { value: 'now', label: 'Start now', icon: 'IconRocket' },
      { value: 'backlog', label: 'Backlog', icon: 'IconArchive' },
    ]);
    const now = suggestion('b', 'open');
    expect(resolveSuggestionStart(now)).toBe('now');
    expect(listSuggestionStarts(now)).toEqual([
      { value: 'now', label: 'Start now', icon: 'IconRocket', hint: 'Suggested' },
      { value: 'after', label: 'After this task merges', icon: 'IconHourglass' },
      { value: 'backlog', label: 'Backlog', icon: 'IconArchive' },
    ]);
  });
});
