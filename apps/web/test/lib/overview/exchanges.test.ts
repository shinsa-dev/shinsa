import { describe, expect, it } from 'bun:test';
import type { AgentReply, Iteration } from '@shinsa/core';
import {
  describeOutcomes,
  describeRequestLabel,
  describeRequestText,
  describeSentLabel,
  listEarlierReplies,
  selectShownReply,
  selectWorkingRequest,
} from '@/lib/overview/exchanges.ts';
import { createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

const REPLY: AgentReply = {
  headline: 'Moved it.',
  points: [
    { ask: 'Move it', outcome: 'done', note: 'Under Remote access.' },
    { ask: 'Rename it', outcome: 'done', note: 'Now Slack.' },
    { ask: 'Does it need a setting?', outcome: 'answered', note: 'Yes.' },
    { ask: 'Drop the stream', outcome: 'not_changed', note: 'Slack needs it.' },
  ],
  next: null,
};

function iteration(id: string, overrides: Partial<Iteration> = {}): Iteration {
  return {
    id,
    round: 1,
    requests: [{ text: `Request ${id}`, comments: 0, at: 1 }],
    reply: REPLY,
    runId: 'run-1',
    repliedAt: 10,
    ...overrides,
  };
}

const REVIEW = createGate({ id: 'g', taskId: 't', type: 'review' });

const STATE = createShinsaState({
  runs: [
    createRun({ id: 'run-1', taskId: 't', purpose: 'fix' }),
    createRun({ id: 'run-plan', taskId: 't', purpose: 'plan' }),
    createRun({ id: 'run-answer', taskId: 't', role: 'answerer' }),
  ],
});

const RESULT = { step: 'answer' as const, body: 'It is.', at: 10, runId: 'run-answer' };

describe('selectShownReply', () => {
  it('shows the latest answered request of the current round at the review and merge gates', () => {
    const task = createTask({ id: 't', iterations: [iteration('a'), iteration('b')] });
    expect(selectShownReply(STATE, task, REVIEW)?.id).toBe('b');
    expect(selectShownReply(STATE, task, { ...REVIEW, type: 'merge' })?.id).toBe('b');
  });

  it('shows a plan reply on the plan card and never at review', () => {
    const task = createTask({ id: 't', iterations: [iteration('a', { runId: 'run-plan' })] });
    expect(selectShownReply(STATE, task, { ...REVIEW, type: 'plan' })?.id).toBe('a');
    expect(selectShownReply(STATE, task, REVIEW)).toBeNull();
    expect(
      selectShownReply(STATE, createTask({ id: 't', iterations: [iteration('b')] }), {
        ...REVIEW,
        type: 'plan',
      })
    ).toBeNull();
  });

  it('shows the reply of the run that wrote the result on the proposal and result cards', () => {
    const task = createTask({
      id: 't',
      result: RESULT,
      iterations: [iteration('a', { runId: 'run-answer' })],
    });
    expect(selectShownReply(STATE, task, { ...REVIEW, type: 'proposal' })?.id).toBe('a');
    expect(selectShownReply(STATE, task, { ...REVIEW, type: 'result' })?.id).toBe('a');
    expect(selectShownReply(STATE, task, undefined)?.id).toBe('a');
    const other = createTask({ id: 't', result: RESULT, iterations: [iteration('b')] });
    expect(selectShownReply(STATE, other, undefined)).toBeNull();
    const unanswered = createTask({ id: 't', result: RESULT, iterations: [iteration('c', { runId: null })] });
    expect(selectShownReply(STATE, unanswered, undefined)).toBeNull();
  });

  it('shows nothing at another gate, before an answer or from an earlier round', () => {
    const task = createTask({ id: 't', iterations: [iteration('a')] });
    expect(selectShownReply(STATE, task, { ...REVIEW, type: 'question' })).toBeNull();
    expect(selectShownReply(STATE, task, undefined)).toBeNull();
    expect(selectShownReply(STATE, createTask({ id: 't' }), REVIEW)).toBeNull();
    const open = createTask({ id: 't', iterations: [iteration('a', { reply: null, repliedAt: null })] });
    expect(selectShownReply(STATE, open, REVIEW)).toBeNull();
    const earlier = createTask({ id: 't', iterations: [iteration('a', { round: 2 })] });
    expect(selectShownReply(STATE, earlier, REVIEW)).toBeNull();
  });
});

describe('selectWorkingRequest', () => {
  it('is the open request while the agent fixes, and nothing otherwise', () => {
    const open = iteration('a', { reply: null, repliedAt: null });
    expect(selectWorkingRequest(createTask({ id: 't', stage: 'fixing', iterations: [open] }))).toBe(open);
    expect(selectWorkingRequest(createTask({ id: 't', stage: 'checking', iterations: [open] }))).toBeNull();
    expect(
      selectWorkingRequest(createTask({ id: 't', stage: 'fixing', iterations: [iteration('b')] }))
    ).toBeNull();
  });
});

describe('listEarlierReplies', () => {
  it('lists answered requests newest first, leaving out the shown one', () => {
    const task = createTask({
      id: 't',
      iterations: [
        iteration('a', { repliedAt: 30 }),
        iteration('b', { repliedAt: 50 }),
        iteration('c', { reply: null, repliedAt: null }),
      ],
    });
    expect(listEarlierReplies(task, 'b').map((reply) => reply.id)).toEqual(['a']);
    expect(listEarlierReplies(task, null).map((reply) => [reply.id, reply.repliedAt])).toEqual([
      ['b', 50],
      ['a', 30],
    ]);
    expect(listEarlierReplies(createTask({ id: 't' }), null)).toEqual([]);
  });
});

describe('describeRequestText', () => {
  it('joins what you sent and counts the line comments', () => {
    const one = iteration('a', { requests: [{ text: 'Move it.', comments: 0, at: 1 }] });
    expect(describeRequestText(one)).toBe('Move it.');
    const many = iteration('a', {
      requests: [
        { text: 'Move it.', comments: 1, at: 1 },
        { text: 'And rename it.', comments: 1, at: 2 },
      ],
    });
    expect(describeRequestText(many)).toBe('Move it.\n\nAnd rename it.\nAnd 2 line comments.');
    const comments = iteration('a', { requests: [{ text: '', comments: 1, at: 1 }] });
    expect(describeRequestText(comments)).toBe('1 line comment');
    expect(describeRequestText(iteration('a', { requests: [{ text: '', comments: 0, at: 1 }] }))).toBe('');
  });
});

describe('describeOutcomes', () => {
  it('counts each outcome the reply has, in a fixed order', () => {
    expect(describeOutcomes(REPLY)).toBe('2 done · 1 answered · 1 not changed');
    expect(describeOutcomes({ ...REPLY, points: [REPLY.points[2] as AgentReply['points'][number]] })).toBe(
      '1 answered'
    );
  });
});

describe('describeSentLabel and describeRequestLabel', () => {
  it('say you on your own page and name the owner for anyone else', () => {
    expect(describeSentLabel()).toBe('What you sent');
    expect(describeSentLabel('Kai')).toBe('What Kai sent');
    expect(describeSentLabel('The owner')).toBe('What the owner sent');
    const kai = { login: 'kai', name: 'Kai Lane', avatarUrl: null };
    expect(describeRequestLabel()).toEqual(['Your', ' request']);
    expect(describeRequestLabel({ name: 'Kai', user: kai })).toEqual([
      { user: kai, label: 'Kai’s' },
      ' request',
    ]);
    expect(describeRequestLabel({ name: 'The owner', user: null })).toEqual(['The owner’s', ' request']);
  });
});
