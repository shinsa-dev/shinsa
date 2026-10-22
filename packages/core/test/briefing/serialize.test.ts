import { describe, expect, test } from 'bun:test';
import { resolveFallbackBriefing, selectBriefingGate, serializeBriefing } from '../../src/index.ts';
import { chat, docs, dup, NOW, queueOf, ready, stateOf, tools } from './fixtures.ts';

describe('serializeBriefing', () => {
  test('writes one plain paragraph with titles', () => {
    const briefing = resolveFallbackBriefing(queueOf(ready.slice(0, 2), { working: [tools] }), NOW);
    expect(serializeBriefing(briefing, stateOf([chat, dup, tools]))).toBe(
      'Start with “Embedded chat rework”: built and checked, the changes are ready for your review, and it unblocks 1 other task. Then “Fix code-first duplicate”. An agent is building “Tool calls in chat”.'
    );
  });
});

describe('serializeBriefing without decisions', () => {
  test('says nothing needs you, and names an unknown task plainly', () => {
    const briefing = {
      now: null,
      next: [{ taskId: 'gone', why: 'x' }],
      running: 'No agent is working right now.',
      note: 'Heads up.',
    };
    expect(serializeBriefing(briefing, stateOf([]))).toBe(
      'Nothing needs you right now. Then “a task”. No agent is working right now. Heads up.'
    );
  });

  test('lists three next tasks with a final and, and keeps an acronym capitalised', () => {
    const briefing = {
      now: { taskId: 't-chat', why: 'CI is green and it unblocks more' },
      next: [chat, dup, docs].map((value) => ({ taskId: value.id, why: 'x' })),
      running: 'No agent is working right now.',
      note: null,
    };
    expect(serializeBriefing(briefing, stateOf([chat, dup, docs]))).toBe(
      'Start with “Embedded chat rework”: CI is green and it unblocks more. Then “Embedded chat rework”, “Fix code-first duplicate” and “Document the engine”. No agent is working right now.'
    );
  });
});

describe('selectBriefingGate', () => {
  test('finds the open decision of a task the guide names', () => {
    const queue = queueOf(ready);
    expect(selectBriefingGate(queue, 't-dup')?.kind).toBe('merge');
    expect(selectBriefingGate(queue, 't-gone')).toBeNull();
  });
});
