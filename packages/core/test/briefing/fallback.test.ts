import { describe, expect, test } from 'bun:test';
import { resolveFallbackBriefing } from '../../src/index.ts';
import { chat, docs, dup, entry, NOW, queueOf, ready, task, tools } from './fixtures.ts';

describe('resolveFallbackBriefing', () => {
  test('follows the ranked queue and says what each decision is', () => {
    const briefing = resolveFallbackBriefing(queueOf(ready, { working: [tools] }), NOW);
    expect(briefing.now).toEqual({
      taskId: 't-chat',
      why: 'Built and checked, the changes are ready for your review, and it unblocks 1 other task',
    });
    expect(briefing.next.map((item) => item.taskId)).toEqual(['t-dup', 't-docs']);
    expect(briefing.next[0]?.why).toBe('The pull request is clean and ready to merge');
    expect(briefing.running).toBe('An agent is building “Tool calls in chat”.');
    expect(briefing.note).toBeNull();
  });

  test('lists a task once even when it has two open gates', () => {
    const briefing = resolveFallbackBriefing(
      queueOf([
        entry(chat, 'question', { purpose: 'agent_question' }),
        entry(chat, 'review'),
        entry(dup, 'merge'),
      ]),
      NOW
    );
    expect(briefing.now?.taskId).toBe('t-chat');
    expect(briefing.next.map((item) => item.taskId)).toEqual(['t-dup']);
  });

  test('names two working tasks and counts the rest', () => {
    const more = [tools, task('t-a', 'Bump effect-orm'), task('t-b', 'Stream tool results')];
    expect(resolveFallbackBriefing(queueOf([], { working: more }), NOW).running).toBe(
      'Agents are working on “Tool calls in chat”, “Bump effect-orm” and 1 more.'
    );
  });

  test('with nothing to decide, has no now and says so', () => {
    const briefing = resolveFallbackBriefing(queueOf([]), NOW);
    expect(briefing.now).toBeNull();
    expect(briefing.next).toEqual([]);
    expect(briefing.running).toBe('No agent is working right now.');
  });

  test('flags a paused task and a merge that has waited for days, beyond the ones it names', () => {
    const more = [
      task('t-a', 'Bump effect-orm'),
      task('t-b', 'Stream tool results'),
      task('t-c', 'Retry exports'),
    ];
    const named = [entry(chat, 'review'), ...more.map((value) => entry(value, 'review'))];
    const paused = resolveFallbackBriefing(
      queueOf([...named, entry(docs, 'question', { purpose: 'failure', title: 'Checks kept failing' })]),
      NOW
    );
    expect(paused.note).toBe('“Document the engine” is paused and needs a decision.');
    const stale = resolveFallbackBriefing(
      queueOf([...named, entry(dup, 'merge', { openedAt: NOW - 3 * 24 * 60 * 60 * 1000 })]),
      NOW
    );
    expect(stale.note).toBe('“Fix code-first duplicate” has waited 3 days to merge.');
  });

  test('never notes a task the guide already names in now or next', () => {
    const paused = resolveFallbackBriefing(
      queueOf([
        entry(chat, 'review'),
        entry(docs, 'question', { purpose: 'failure', title: 'Checks kept failing' }),
        entry(dup, 'merge', { openedAt: NOW - 3 * 24 * 60 * 60 * 1000 }),
      ]),
      NOW
    );
    expect(paused.next.map((item) => item.taskId)).toEqual(['t-docs', 't-dup']);
    expect(paused.note).toBeNull();
    const held = resolveFallbackBriefing(
      queueOf([entry(chat, 'review'), entry(docs, 'question', { purpose: 'failure' })], {
        held: [entry(tools, 'review')],
      }),
      NOW
    );
    expect(held.note).toBeNull();
  });

  test('never mentions decisions outside the focus', () => {
    const briefing = resolveFallbackBriefing(
      queueOf([entry(chat, 'review')], { held: [entry(tools, 'review'), entry(docs, 'spec')] }),
      NOW
    );
    expect(briefing.note).toBeNull();
  });
});

describe('resolveFallbackBriefing notes', () => {
  test('mentions tasks waiting for another one when nothing else needs flagging', () => {
    const one = resolveFallbackBriefing(queueOf([entry(chat, 'review')], { waiting: [tools] }), NOW);
    expect(one.note).toBe('1 task is waiting for another task to finish first.');
    const two = resolveFallbackBriefing(queueOf([entry(chat, 'review')], { waiting: [tools, docs] }), NOW);
    expect(two.note).toBe('2 tasks are waiting for another task to finish first.');
  });

  test('cuts a long why at the limit', () => {
    const long = entry(task('t-long', 'Long'), 'question', { purpose: 'failure', title: 'x'.repeat(200) });
    const why = resolveFallbackBriefing(queueOf([long]), NOW).now?.why ?? '';
    expect(why).toHaveLength(140);
    expect(why.endsWith('…')).toBe(true);
  });

  test('says what an agent question and a merge without a pull request need', () => {
    const asked = entry(task('t-ask', 'Ask'), 'question', { purpose: 'agent_question', title: 'Which tab?' });
    const merge = entry(task('t-merge', 'Merge'), 'merge');
    const briefing = resolveFallbackBriefing(queueOf([asked, merge]), NOW);
    expect(briefing.now?.why).toBe('An agent is waiting on your answer: Which tab?');
    expect(briefing.next[0]?.why).toBe('Clean and ready to merge');
  });

  test('names one working task with what it is doing', () => {
    const briefing = resolveFallbackBriefing(queueOf([], { working: [tools] }), NOW);
    expect(briefing.running).toBe('An agent is building “Tool calls in chat”.');
    const other = resolveFallbackBriefing(queueOf([], { working: [{ ...tools, stage: 'fixing' }] }), NOW);
    expect(other.running).toBe('An agent is working on “Tool calls in chat”.');
  });
});
