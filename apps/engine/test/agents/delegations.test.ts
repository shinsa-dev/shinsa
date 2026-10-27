import { describe, expect, test } from 'bun:test';
import {
  CHAT_PROTOCOL_VERSION,
  type ChatEntry,
  type DeliveryClaim,
  type Run,
  type RunDelegation,
} from '@shinsa/core';
import { awaitDelegation, resolveDelegatedReply, resolveDelivery } from '../../src/agents/delegations.ts';
import { createRun, createStubEngine } from '../helpers/state.ts';

function delegation(patch: Partial<RunDelegation> = {}): RunDelegation {
  return {
    parentRunId: 'parent',
    depth: 1,
    requestKey: 'k',
    title: 'Check the copy',
    brief: 'Check it.',
    mode: 'async',
    wake: 'always',
    isolation: 'shared',
    baseCommit: null,
    delivery: 'none',
    question: null,
    requestedAt: 0,
    ...patch,
  };
}

const QUESTION = {
  id: 'q1',
  question: 'Keep it?',
  context: 'Two callers use it.',
  choices: ['Keep', 'Drop'],
  recommendation: null,
  askedAt: 0,
  delivered: false,
  answer: null,
  answeredAt: null,
};

function withParent(
  claim: DeliveryClaim | null,
  runs: Run[],
  messages = [{ id: 'm1', text: 'Also the footer.' }]
) {
  const parent = createRun({
    id: 'parent',
    status: 'waiting',
    cohort: { nextGeneration: 3, claim, deferred: false, messages },
  });
  const stub = createStubEngine((state) => {
    state.runs.parent = parent;
    for (const run of runs) state.runs[run.id] = run;
  });
  return { state: stub.state, parent };
}

function entry(event: Partial<ChatEntry> & { type: ChatEntry['type'] }, index: number) {
  return { v: CHAT_PROTOCOL_VERSION, id: `e${index}`, at: index, ...event } as ChatEntry;
}

describe('resolveDelivery', () => {
  test('writes the report for the items of the current claim, results then questions then the human', () => {
    const finished = createRun({
      id: 'done',
      role: 'reviewer',
      endedAt: 5,
      outcome: 'completed',
      summary: 'All good.',
      delegation: delegation(),
    });
    const asking = createRun({
      id: 'asking',
      delegation: delegation({ title: 'Port it', question: QUESTION }),
    });
    const claim: DeliveryClaim = {
      generation: 2,
      items: ['question:asking:q1', 'result:done', 'message:m1'],
      via: 'wake',
    };
    const { state, parent } = withParent(claim, [finished, asking]);
    const delivery = resolveDelivery(state, parent);
    expect(delivery?.generation).toBe(2);
    expect(delivery?.items).toEqual(claim.items);
    expect(delivery?.runIds).toEqual(['done', 'asking']);
    expect(delivery?.text).toContain(
      'Delegation finished: "Check the copy" (delegation id done, reviewer):\n\nAll good.'
    );
    expect(delivery?.text).toContain(
      'Delegation "Port it" (delegation id asking) is waiting for your answer:\nKeep it?'
    );
    expect(delivery?.text).toContain('The human added: Also the footer.');
  });

  test('leaves out what no longer needs saying, and anything that is not this run’s', () => {
    const acknowledged = createRun({
      id: 'seen',
      endedAt: 5,
      outcome: 'completed',
      delegation: delegation({ delivery: 'acknowledged' }),
    });
    const answered = createRun({
      id: 'answered',
      delegation: delegation({ question: { ...QUESTION, answer: 'Keep' } }),
    });
    const ended = createRun({
      id: 'ended',
      endedAt: 5,
      outcome: 'cancelled',
      delegation: delegation({ question: QUESTION }),
    });
    const stranger = createRun({
      id: 'stranger',
      endedAt: 5,
      delegation: delegation({ parentRunId: 'other' }),
    });
    const step = createRun({ id: 'step', endedAt: 5 });
    const claim: DeliveryClaim = {
      generation: 1,
      items: [
        'result:seen',
        'question:answered:q1',
        'question:ended:q1',
        'result:stranger',
        'result:step',
        'result:gone',
        'message:gone',
        'nonsense',
      ],
      via: 'steer',
    };
    const { state, parent } = withParent(claim, [acknowledged, answered, ended, stranger, step], []);
    const delivery = resolveDelivery(state, parent);
    expect(delivery?.runIds).toEqual([]);
    expect(delivery?.items).toEqual(claim.items);
  });

  test('a run with nothing claimed has nothing to deliver', () => {
    const { state, parent } = withParent(null, []);
    expect(resolveDelivery(state, parent)).toBeNull();
    expect(resolveDelivery(state, createRun())).toBeNull();
  });
});

describe('awaitDelegation', () => {
  function engineWith(run: Run) {
    return createStubEngine((state) => {
      state.runs[run.id] = run;
    });
  }

  test('returns at once for a task that has ended, is gone, or asks', async () => {
    const signal = new AbortController().signal;
    const ended = engineWith(createRun({ id: 'c', endedAt: 1, delegation: delegation() }));
    expect(await awaitDelegation(ended.engine, 'c', 1_000, signal)).toBe('settled');
    expect(await awaitDelegation(ended.engine, 'gone', 1_000, signal)).toBe('settled');
    const asking = engineWith(createRun({ id: 'c', delegation: delegation({ question: QUESTION }) }));
    expect(await awaitDelegation(asking.engine, 'c', 1_000, signal)).toBe('question');
  });

  test('a question it has already seen does not end the wait', async () => {
    const seen = engineWith(
      createRun({ id: 'c', delegation: delegation({ question: { ...QUESTION, delivered: true } }) })
    );
    expect(await awaitDelegation(seen.engine, 'c', 5, new AbortController().signal)).toBe('timeout');
  });

  test('wakes when the state changes, and stops listening once it has an answer', async () => {
    const stub = engineWith(createRun({ id: 'c', delegation: delegation() }));
    const waiting = awaitDelegation(stub.engine, 'c', 10_000, new AbortController().signal);
    stub.notify();
    stub.update((state) => {
      state.runs.c = createRun({ id: 'c', endedAt: 9, delegation: delegation() });
    });
    stub.notify();
    expect(await waiting).toBe('settled');
  });

  test('a stopped tool call ends the wait as if it timed out', async () => {
    const stub = engineWith(createRun({ id: 'c', delegation: delegation() }));
    const controller = new AbortController();
    const waiting = awaitDelegation(stub.engine, 'c', 10_000, controller.signal);
    controller.abort();
    expect(await waiting).toBe('timeout');
    expect(await awaitDelegation(stub.engine, 'c', 10_000, controller.signal)).toBe('timeout');
  });
});

describe('resolveDelegatedReply', () => {
  test('is the last thing the agent said in its last turn, never a subagent’s words', () => {
    const entries = [
      entry({ type: 'user', from: 'shinsa', text: 'Brief.', attachments: [] }, 1),
      entry({ type: 'agent', phase: 'interim', text: 'Looking.' }, 2),
      entry({ type: 'agent', phase: 'final', text: 'Found it.' }, 3),
      entry({ type: 'agent', phase: 'interim', text: 'Sub.', parentCallId: 'c1' }, 4),
      entry({ type: 'agent', phase: 'final', text: '   ' }, 5),
      entry({ type: 'status', status: 'ended', outcome: 'completed' }, 6),
    ];
    expect(resolveDelegatedReply(entries)).toBe('Found it.');
  });

  test('a turn that said nothing has no reply', () => {
    expect(
      resolveDelegatedReply([
        entry({ type: 'agent', phase: 'final', text: 'Old turn.' }, 1),
        entry({ type: 'user', from: 'shinsa', text: 'Answer: yes.', attachments: [] }, 2),
      ])
    ).toBeNull();
    expect(resolveDelegatedReply([])).toBeNull();
  });
});
