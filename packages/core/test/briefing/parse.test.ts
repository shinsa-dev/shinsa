import { describe, expect, test } from 'bun:test';
import { parseBriefing } from '../../src/index.ts';
import { chat, docs, dup, entry, NOW, queueOf, ready, task, tools } from './fixtures.ts';

describe('parseBriefing', () => {
  const queue = queueOf(ready, { working: [tools] });

  test('keeps a valid answer and the model’s order', () => {
    const briefing = parseBriefing(
      {
        now: { task: 't-dup', why: 'It is clean, and merging it first keeps main moving.' },
        next: [{ task: 't-chat', why: 'Review it next; it unblocks the tool calls work' }],
        note: null,
      },
      queue,
      NOW
    );
    expect(briefing).toEqual({
      now: { taskId: 't-dup', why: 'It is clean, and merging it first keeps main moving' },
      next: [{ taskId: 't-chat', why: 'Review it next; it unblocks the tool calls work' }],
      running: 'An agent is building “Tool calls in chat”.',
      note: null,
    });
  });

  test('rejects an answer whose now is not a decision in the queue', () => {
    expect(parseBriefing({ now: { task: 't-tools', why: 'x' }, next: [] }, queue, NOW)).toBeNull();
    expect(parseBriefing({ now: { task: 'made-up' } }, queue, NOW)).toBeNull();
    expect(parseBriefing(null, queue, NOW)).toBeNull();
    expect(parseBriefing('Start with the chat', queue, NOW)).toBeNull();
  });

  test('drops unknown, repeated and extra next items', () => {
    const briefing = parseBriefing(
      {
        now: { task: 't-chat', why: 'Unblocks the tool calls work' },
        next: [
          { task: 't-chat', why: 'again' },
          { task: 'nope', why: 'unknown' },
          { task: 't-tools', why: 'working, not a decision' },
          { task: 't-docs', why: 'The plan waits for approval' },
        ],
      },
      queue,
      NOW
    );
    expect(briefing?.next).toEqual([{ taskId: 't-docs', why: 'The plan waits for approval' }]);
  });

  test('falls back to the ranked order when next is empty or missing', () => {
    const briefing = parseBriefing({ now: { task: 't-chat', why: 'Unblocks other work' } }, queue, NOW);
    expect(briefing?.next.map((item) => item.taskId)).toEqual(['t-dup', 't-docs']);
  });

  test('replaces a why that claims a review is ready to merge or points at a position', () => {
    const briefing = parseBriefing(
      {
        now: { task: 't-chat', why: 'It is ready to merge right away' },
        next: [
          { task: 't-dup', why: 'Then item three is next' },
          { task: 't-docs', why: 'Document the engine needs its plan approved' },
        ],
      },
      queue,
      NOW
    );
    expect(briefing?.now?.why).toBe(
      'Built and checked, the changes are ready for your review, and it unblocks 1 other task'
    );
    expect(briefing?.next[0]?.why).toBe('The pull request is clean and ready to merge');
    expect(briefing?.next[1]?.why).toBe('The plan needs your approval before building starts');
  });

  test('cleans dashes and exclamation marks, and caps lengths', () => {
    const briefing = parseBriefing(
      {
        now: { task: 't-chat', why: 'it unblocks the tool calls work — start here!' },
        note: 'x'.repeat(400),
      },
      queue,
      NOW
    );
    expect(briefing?.now?.why).toBe('It unblocks the tool calls work, start here');
    expect(briefing?.note).toBeNull();
  });

  test('rejects text that names a task by id, and curls straight quotes', () => {
    const briefing = parseBriefing(
      {
        now: { task: 't-chat', why: 'Review it so "Tool calls in chat" can carry on' },
        next: [{ task: 't-dup', why: 'Merge t-dup after that' }],
        note: 'T-docs is waiting on a plan approval.',
      },
      queue,
      NOW
    );
    expect(briefing?.now?.why).toBe('Review it so “Tool calls in chat” can carry on');
    expect(briefing?.next[0]?.why).toBe('The pull request is clean and ready to merge');
    expect(briefing?.note).toBeNull();
  });

  test('drops a note that names a task in now or next and falls back to one that does not', () => {
    const paused = entry(docs, 'question', { purpose: 'failure', title: 'Checks kept failing' });
    const withPaused = queueOf([entry(chat, 'review'), paused]);
    const briefing = parseBriefing(
      {
        now: { task: 't-chat', why: 'It unblocks the tool calls work' },
        next: [{ task: 't-docs', why: 'The checks kept failing and it needs a decision' }],
        note: '“Document the engine” is paused because the checks kept failing.',
      },
      withPaused,
      NOW
    );
    expect(briefing?.note).toBeNull();
    const quoted = parseBriefing(
      {
        now: { task: 't-chat', why: 'It unblocks the tool calls work' },
        next: [{ task: 't-docs', why: 'The checks kept failing' }],
        note: '“Document the engine” needs a decision.',
      },
      queueOf([entry(chat, 'review'), paused]),
      NOW
    );
    expect(quoted?.note).toBeNull();
    const shortened = parseBriefing(
      {
        now: { task: 't-dup', why: 'It is clean' },
        next: [],
        note: 'Remember “Fix code-first” has waited a while.',
      },
      queue,
      NOW
    );
    expect(shortened?.note).toBeNull();
  });

  test('keeps a note about a task the guide does not name', () => {
    const briefing = parseBriefing(
      {
        now: { task: 't-chat', why: 'It unblocks the tool calls work' },
        next: [{ task: 't-dup', why: 'The pull request is ready' }],
        note: '“Document the engine” has a plan that has waited a while.',
      },
      queue,
      NOW
    );
    expect(briefing?.note).toBe('“Document the engine” has a plan that has waited a while.');
  });

  test('with nothing to decide, returns the plain briefing', () => {
    expect(parseBriefing({ now: { task: 't-chat' } }, queueOf([]), NOW)?.now).toBeNull();
  });
});

describe('parseBriefing order', () => {
  test('moves low priority decisions to the end of next', () => {
    const low = task('t-low', 'Tidy the docs', { priority: 'low' });
    const queue = queueOf([entry(chat, 'review'), entry(low, 'review'), entry(dup, 'merge')]);
    const briefing = parseBriefing(
      { now: { task: 't-chat' }, next: [{ task: 't-low' }, { task_id: 't-dup', why: null }] },
      queue,
      NOW
    );
    expect(briefing?.next.map((item) => item.taskId)).toEqual(['t-dup', 't-low']);
  });

  test('a low priority now is only allowed when every decision is low', () => {
    const low = task('t-low', 'Tidy the docs', { priority: 'low' });
    expect(
      parseBriefing({ now: { taskId: 't-low' } }, queueOf([entry(chat, 'review'), entry(low, 'review')]), NOW)
    ).toBeNull();
    expect(
      parseBriefing({ now: { taskId: 't-low' } }, queueOf([entry(low, 'review')]), NOW)?.now?.taskId
    ).toBe('t-low');
  });

  test('rejects an answer that is not an object', () => {
    expect(parseBriefing('Start with the chat.', queueOf(ready), NOW)).toBeNull();
    expect(parseBriefing({ now: 't-chat' }, queueOf(ready), NOW)).toBeNull();
  });

  test('keeps a why that starts with something other than the title, and an explicit null note', () => {
    const briefing = parseBriefing(
      { now: { task: 't-chat', why: 'It unblocks the tool work.' }, note: null },
      queueOf(ready, { waiting: [tools] }),
      NOW
    );
    expect(briefing?.now?.why).toBe('It unblocks the tool work');
    expect(briefing?.note).toBeNull();
  });
});
