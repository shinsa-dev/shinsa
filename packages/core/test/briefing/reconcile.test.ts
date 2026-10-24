import { describe, expect, test } from 'bun:test';
import { reconcileBriefing } from '../../src/index.ts';
import { dup, entry, NOW, queueOf, ready } from './fixtures.ts';

describe('reconcileBriefing', () => {
  const queue = queueOf(ready);
  const stored = {
    text: '',
    at: NOW,
    briefing: {
      now: { taskId: 't-chat', why: 'Unblocks the tool calls work' },
      next: [
        { taskId: 't-gone', why: 'Merged since' },
        { taskId: 't-docs', why: 'Approve the plan' },
      ],
      running: 'Stale running line.',
      note: 'Heads up.',
    },
  };

  test('keeps the stored guide, drops items that left the queue and recomputes running', () => {
    const briefing = reconcileBriefing(stored, queue, NOW);
    expect(briefing.now?.why).toBe('Unblocks the tool calls work');
    expect(briefing.next.map((item) => item.taskId)).toEqual(['t-docs']);
    expect(briefing.running).toBe('No agent is working right now.');
    expect(briefing.note).toBe('Heads up.');
  });

  test('falls back when the stored now no longer needs you', () => {
    const briefing = reconcileBriefing(stored, queueOf([entry(dup, 'merge')]), NOW);
    expect(briefing.now?.taskId).toBe('t-dup');
    expect(briefing.note).toBeNull();
  });

  test('drops a stored note that names a task the guide now lists', () => {
    const repeated = {
      ...stored,
      briefing: { ...stored.briefing, note: '“Document the engine” is paused and needs a decision.' },
    };
    const briefing = reconcileBriefing(repeated, queue, NOW);
    expect(briefing.next.map((item) => item.taskId)).toEqual(['t-docs']);
    expect(briefing.note).toBeNull();
  });

  test('reads a briefing stored before guides had structure', () => {
    const briefing = reconcileBriefing({ text: 'Start with the chat.', at: NOW, briefing: null }, queue, NOW);
    expect(briefing.now?.taskId).toBe('t-chat');
  });
});

describe('reconcileBriefing next', () => {
  test('falls back to the ranked order when every stored next item left', () => {
    const stored = {
      text: '',
      at: NOW,
      briefing: {
        now: { taskId: 't-chat', why: 'Kept' },
        next: [{ taskId: 't-gone', why: 'x' }],
        running: '',
        note: null,
      },
    };
    expect(reconcileBriefing(stored, queueOf(ready), NOW).next.map((item) => item.taskId)).toEqual([
      't-dup',
      't-docs',
    ]);
  });
});
