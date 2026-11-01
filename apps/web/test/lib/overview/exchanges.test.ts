import { describe, expect, it } from 'bun:test';
import type { AgentReply, Iteration } from '@shinsa/core';
import {
  describeOutcomes,
  describeRequestText,
  listEarlierReplies,
  selectShownReply,
  selectWorkingRequest,
} from '@/lib/overview/exchanges.ts';
import { createGate, createTask } from '../../support/state.ts';

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

describe('selectShownReply', () => {
  it('shows the latest answered request of the current round at the review and merge gates', () => {
    const task = createTask({ id: 't', iterations: [iteration('a'), iteration('b')] });
    expect(selectShownReply(task, REVIEW)?.id).toBe('b');
    expect(selectShownReply(task, { ...REVIEW, type: 'merge' })?.id).toBe('b');
  });

  it('shows nothing at another gate, with no gate, before an answer or from an earlier round', () => {
    const task = createTask({ id: 't', iterations: [iteration('a')] });
    expect(selectShownReply(task, { ...REVIEW, type: 'plan' })).toBeNull();
    expect(selectShownReply(task, undefined)).toBeNull();
    expect(selectShownReply(createTask({ id: 't' }), REVIEW)).toBeNull();
    const open = createTask({ id: 't', iterations: [iteration('a', { reply: null, repliedAt: null })] });
    expect(selectShownReply(open, REVIEW)).toBeNull();
    const earlier = createTask({ id: 't', iterations: [iteration('a', { round: 2 })] });
    expect(selectShownReply(earlier, REVIEW)).toBeNull();
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
