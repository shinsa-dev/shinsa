import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  describeSuggestionDetail,
  describeSuggestionStatus,
  resolveSuggestionProject,
  selectCallSuggestion,
  selectSourceSuggestion,
  WATCH_SUGGESTION_ACTIONS,
} from '@/lib/watch-suggestions.ts';
import { spyOnCommands } from '../support/commands.ts';
import { createWatchSuggestion } from '../support/schedules.ts';
import { createProject, createShinsaState } from '../support/state.ts';

const OPEN = createWatchSuggestion({ id: 's1' });

const DISMISSED = createWatchSuggestion({ id: 's2', server: 'maple', status: 'dismissed' });

const FROM_AGENT = createWatchSuggestion({
  id: 's3',
  server: 'maple',
  text: 'File a task for each new error in Maple.',
  origin: { kind: 'agent', taskId: 't1', runId: 'r1' },
  status: 'accepted',
  scheduleId: 'w1',
});

const STATE = createShinsaState({
  projects: [createProject({ id: 'p1', name: 'Superwall' })],
  patch: { watchSuggestions: { s1: OPEN, s2: DISMISSED, s3: FROM_AGENT } },
});

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

describe('suggested watches', () => {
  it('finds the open suggestion for an integration of a project, never a decided one', () => {
    expect(selectSourceSuggestion(STATE, 'p1', 'slack')).toBe(OPEN);
    expect(selectSourceSuggestion(STATE, 'p1', 'maple')).toBeNull();
    expect(selectSourceSuggestion(STATE, 'p2', 'slack')).toBeNull();
  });

  it('describes where it reads and when, with its project when asked', () => {
    expect(describeSuggestionDetail(OPEN)).toBe('slack · every hour');
    expect(describeSuggestionDetail(OPEN, resolveSuggestionProject(STATE, OPEN))).toBe(
      'slack · every hour · Superwall'
    );
    expect(resolveSuggestionProject(STATE, { ...OPEN, projectId: 'gone' })).toBeNull();
  });

  it('finds the suggestion an agent’s set_schedule call made, by its task, source and message', () => {
    const args = { source: 'maple', message: ' File a task for each new error in Maple. ' };
    expect(selectCallSuggestion(STATE, 't1', args)).toBe(FROM_AGENT);
    expect(selectCallSuggestion(STATE, 't2', args)).toBeNull();
    expect(selectCallSuggestion(STATE, 't1', { ...args, source: 'slack' })).toBeNull();
    expect(selectCallSuggestion(STATE, null, { source: 'slack', message: OPEN.text })).toBeNull();
  });

  it('says whether it waits for you, was added, was dismissed or is gone', () => {
    expect(describeSuggestionStatus(OPEN)).toBe('Waits for you');
    expect(describeSuggestionStatus(FROM_AGENT)).toBe('Added');
    expect(describeSuggestionStatus(DISMISSED)).toBe('Dismissed');
    expect(describeSuggestionStatus(null)).toBe('No longer open');
  });

  it('accepts and dismisses through the commands, each with its toast', async () => {
    await WATCH_SUGGESTION_ACTIONS.accept(OPEN);
    await WATCH_SUGGESTION_ACTIONS.dismiss(OPEN);
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'watch_suggestion.accept', suggestionId: 's1' }, 'Added the watch “Bugs in #feedback”.'],
      [{ type: 'watch_suggestion.dismiss', suggestionId: 's1' }, 'Dismissed.'],
    ]);
  });
});
