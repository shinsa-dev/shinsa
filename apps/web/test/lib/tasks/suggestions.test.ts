import { describe, expect, it } from 'bun:test';
import type { TaskSuggestion } from '@shinsa/core';
import {
  canBundleSuggestion,
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
    expect(resolveSuggestionStart(waits, false)).toBe('after');
    expect(listSuggestionStarts(waits, false)).toEqual([
      { value: 'after', label: 'After this task merges', icon: 'IconHourglass', hint: 'Suggested' },
      { value: 'now', label: 'Start now', icon: 'IconRocket' },
      { value: 'backlog', label: 'Backlog', icon: 'IconArchive' },
    ]);
    const now = suggestion('b', 'open');
    expect(resolveSuggestionStart(now, false)).toBe('now');
    expect(listSuggestionStarts(now, false)).toEqual([
      { value: 'now', label: 'Start now', icon: 'IconRocket', hint: 'Suggested' },
      { value: 'after', label: 'After this task merges', icon: 'IconHourglass' },
      { value: 'backlog', label: 'Backlog', icon: 'IconArchive' },
    ]);
  });
});

describe('bundling a suggested task with this one', () => {
  const bundle = {
    value: 'bundle' as const,
    label: 'Bundle with this task',
    icon: 'IconLayersThree' as const,
  };

  it('is offered only on an engine that supports it, for a task that opens a pull request and is not finished', () => {
    expect(canBundleSuggestion(createTask({ id: 't' }), true)).toBe(true);
    expect(canBundleSuggestion(createTask({ id: 't' }), false)).toBe(false);
    expect(canBundleSuggestion(createTask({ id: 't', pipeline: ['answer'] }), true)).toBe(false);
    expect(canBundleSuggestion(createTask({ id: 't', stage: 'merged' }), true)).toBe(false);
  });

  it('comes first and is picked when the agent suggested it, and sits before the backlog otherwise', () => {
    const stacked = { ...suggestion('a', 'open'), stacksOnThis: true };
    expect(resolveSuggestionStart(stacked, true)).toBe('bundle');
    expect(listSuggestionStarts(stacked, true)).toEqual([
      { ...bundle, hint: 'Suggested' },
      { value: 'now', label: 'Start now', icon: 'IconRocket' },
      { value: 'after', label: 'After this task merges', icon: 'IconHourglass' },
      { value: 'backlog', label: 'Backlog', icon: 'IconArchive' },
    ]);
    expect(listSuggestionStarts(suggestion('b', 'open'), true)).toEqual([
      { value: 'now', label: 'Start now', icon: 'IconRocket', hint: 'Suggested' },
      { value: 'after', label: 'After this task merges', icon: 'IconHourglass' },
      bundle,
      { value: 'backlog', label: 'Backlog', icon: 'IconArchive' },
    ]);
  });

  it('falls back to the other starts when this task cannot take a bundle', () => {
    const stacked = { ...suggestion('a', 'open'), stacksOnThis: true };
    expect(resolveSuggestionStart(stacked, false)).toBe('now');
    expect(listSuggestionStarts(stacked, false).map((item) => item.value)).toEqual([
      'now',
      'after',
      'backlog',
    ]);
  });
});
