import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  canOpenFeedback,
  countFeedbackWaiting,
  describeFeedbackCount,
  describeFeedbackFiled,
  describeFeedbackIssue,
  describeFeedbackSource,
  describeFeedbackStatus,
  FEEDBACK_ACTIONS,
  isFeedbackOpen,
  listFeedbackGroups,
  needsRedraft,
  openFeedback,
  resolveFeedbackLeaks,
  updateFeedbackOpen,
  useFeedbackOpen,
  validateFeedbackIssue,
  validateFeedbackNote,
} from '@/lib/feedback.ts';
import { spyOnCommands } from '../support/commands.ts';
import { createFeedback } from '../support/feedback.ts';
import { createProject, createShinsaState, createTask } from '../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

const DRAFT = createFeedback({ id: 'f1', createdAt: 3 });
const DRAFTING = createFeedback({ id: 'f2', status: 'drafting', title: null, body: null, createdAt: 2 });
const FILED = createFeedback({
  id: 'f3',
  status: 'filed',
  issue: { number: 42, url: 'https://github.com/shinsa-dev/shinsa/issues/42' },
  createdAt: 1,
});
const FAILED = createFeedback({ id: 'f4', status: 'failed', failure: 'gh is not signed in.', createdAt: 4 });

function stateWith(entries: ReturnType<typeof createFeedback>[], parts = {}) {
  return createShinsaState({
    ...parts,
    patch: { feedback: Object.fromEntries(entries.map((entry) => [entry.id, entry])) },
  });
}

describe('listFeedbackGroups', () => {
  it('puts everything not yet opened first, newest first, and the opened issues apart', () => {
    const groups = listFeedbackGroups(stateWith([DRAFT, DRAFTING, FILED, FAILED]));
    expect(groups.waiting.map((entry) => entry.id)).toEqual(['f4', 'f1', 'f2']);
    expect(groups.filed.map((entry) => entry.id)).toEqual(['f3']);
  });
});

describe('the waiting count', () => {
  it('counts drafts and failures, never what is still being drafted or already opened', () => {
    expect(countFeedbackWaiting(stateWith([DRAFT, DRAFTING, FILED, FAILED]))).toBe(2);
    expect([describeFeedbackCount(0), describeFeedbackCount(3)]).toEqual([null, '3']);
  });
});

describe('describeFeedbackSource', () => {
  it('names you, the agent with its task, or an agent whose task is gone', () => {
    const task = createTask({ id: 't1' });
    const state = stateWith([], { tasks: [task] });
    expect(describeFeedbackSource(state, DRAFT)).toEqual({ label: 'From you', task: null });
    expect(describeFeedbackSource(state, { ...DRAFT, source: 'agent', taskId: 't1' })).toEqual({
      label: 'From the agent on',
      task,
    });
    expect(describeFeedbackSource(state, { ...DRAFT, source: 'agent', taskId: 'gone' })).toEqual({
      label: 'From an agent',
      task: null,
    });
    expect(describeFeedbackSource(state, { ...DRAFT, source: 'agent', taskId: null }).label).toBe(
      'From an agent'
    );
  });
});

describe('describeFeedbackStatus', () => {
  it('says what is happening, or the failure, and nothing for a draft or an opened issue', () => {
    expect(describeFeedbackStatus(DRAFTING)).toBe('Your agent is drafting the issue.');
    expect(describeFeedbackStatus({ ...DRAFT, status: 'filing' })).toBe('Opening the issue on GitHub.');
    expect(describeFeedbackStatus(FAILED)).toBe('gh is not signed in.');
    expect(describeFeedbackStatus({ ...FAILED, failure: null })).toBe('Something went wrong. Try again.');
    expect(describeFeedbackStatus(DRAFT)).toBeNull();
    expect(describeFeedbackStatus(FILED)).toBeNull();
  });

  it('names an opened issue by its number', () => {
    expect([describeFeedbackIssue(FILED), describeFeedbackIssue(DRAFT)]).toEqual(['#42', null]);
  });

  it('says when an issue opened, and that it came from an agent’s report', () => {
    const now = FILED.updatedAt + 2 * 60 * 60 * 1000;
    expect(describeFeedbackFiled({ ...FILED, source: 'human' }, now)).toBe('Opened 2h ago');
    expect(describeFeedbackFiled({ ...FILED, source: 'agent' }, now)).toBe(
      'Opened 2h ago from an agent’s report'
    );
  });
});

describe('resolveFeedbackLeaks', () => {
  it('says which private details a draft still has, and nothing for a clean one', () => {
    const state = stateWith([], { projects: [createProject({ id: 'p1', name: 'Basket', key: 'BK' })] });
    expect(resolveFeedbackLeaks(state, DRAFT)).toBeNull();
    expect(resolveFeedbackLeaks(state, { title: 'Basket plans fail', body: 'Mail me@example.com' })).toBe(
      'This issue still has a name from your projects (“Basket”), an email address (“me@example.com”). Take it out before you open the issue.'
    );
  });
});

describe('what you can do with an entry', () => {
  it('opens a draft or a failure with its text, and drafts again a failure without one', () => {
    expect([
      canOpenFeedback(DRAFT),
      canOpenFeedback(FAILED),
      canOpenFeedback(DRAFTING),
      canOpenFeedback(FILED),
    ]).toEqual([true, true, false, false]);
    expect(needsRedraft({ ...FAILED, title: null, body: null })).toBe(true);
    expect(needsRedraft(FAILED)).toBe(false);
    expect(needsRedraft(DRAFT)).toBe(false);
  });
});

describe('validation', () => {
  it('asks for a note, and keeps it within the limit', () => {
    expect(validateFeedbackNote('  ')).toBe('Write what you want to tell Shinsa.');
    expect(validateFeedbackNote('x'.repeat(4_001))).toBe('Keep it to 4000 characters. It has 4001.');
    expect(validateFeedbackNote('Plans fail.')).toBeNull();
  });

  it('asks for a title and a description within their limits', () => {
    expect(validateFeedbackIssue('', 'Body')).toBe('The issue needs a title and a description.');
    expect(validateFeedbackIssue('Title', ' ')).toBe('The issue needs a title and a description.');
    expect(validateFeedbackIssue('x'.repeat(121), 'Body')).toBe('Keep the title to 120 characters.');
    expect(validateFeedbackIssue('Title', 'x'.repeat(6_001))).toBe(
      'Keep the description to 6000 characters.'
    );
    expect(validateFeedbackIssue('Title', 'Body')).toBeNull();
  });
});

describe('the dialog’s open state', () => {
  it('opens from anywhere and every reader sees it', () => {
    const { result } = renderHook(() => useFeedbackOpen());
    expect(result.current).toBe(false);
    act(() => openFeedback());
    expect(result.current).toBe(true);
    act(() => openFeedback());
    expect(isFeedbackOpen()).toBe(true);
    act(() => updateFeedbackOpen(false));
    expect(result.current).toBe(false);
  });
});

describe('FEEDBACK_ACTIONS', () => {
  it('sends each command with its toast', async () => {
    await FEEDBACK_ACTIONS.write(null, 'Plans fail.');
    await FEEDBACK_ACTIONS.update(DRAFT, 'Title', 'Body');
    await FEEDBACK_ACTIONS.file(DRAFT);
    await FEEDBACK_ACTIONS.dismiss(DRAFT);
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'feedback.write', feedbackId: null, note: 'Plans fail.' },
        'Your agent is drafting the issue.',
      ],
      [{ type: 'feedback.update', feedbackId: 'f1', title: 'Title', body: 'Body' }, 'Issue changed.'],
      [{ type: 'feedback.file', feedbackId: 'f1' }, 'Opening the issue on GitHub.'],
      [{ type: 'feedback.dismiss', feedbackId: 'f1' }, 'Dismissed.'],
    ]);
  });
});
