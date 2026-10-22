import { describe, expect, test } from 'bun:test';
import type { Queue, QueuedGate, ShinsaState, Task } from '@shinsa/core';
import type { QuickJson } from '../../src/agents/quick/index.ts';
import { Briefings, describeBriefingPrompt, resolveBriefing } from '../../src/briefing/index.ts';
import { until } from '../helpers/index.ts';
import { createStubEngine } from '../helpers/state.ts';

const NOW = 5 * 24 * 60 * 60 * 1000;

const chat = {
  id: 't-chat',
  title: 'Embedded chat rework',
  blockedBy: [],
  stage: 'awaiting_review',
  priority: 'normal',
  repoId: 'r1',
  pullRequest: null,
} as unknown as Task;
const tools = {
  id: 't-tools',
  title: 'Tool calls in chat',
  blockedBy: ['t-chat'],
  stage: 'building',
  priority: 'normal',
  repoId: 'r1',
  pullRequest: null,
} as unknown as Task;
const dup = {
  id: 't-dup',
  title: 'Fix code-first duplicate',
  blockedBy: [],
  stage: 'awaiting_merge',
  priority: 'high',
  repoId: 'r1',
  pullRequest: { number: 42 },
} as unknown as Task;

const state = {
  tasks: { [chat.id]: chat, [tools.id]: tools, [dup.id]: dup },
  repos: { r1: { name: 'shinsa' } },
  areas: {},
} as unknown as ShinsaState;

function entry(task: Task, kind: string, unblocks = 0, purpose = 'decision', ageHours = 3) {
  return {
    task,
    gate: {
      id: `g-${task.id}`,
      kind,
      purpose,
      title: 'Decide',
      openedAt: NOW - ageHours * 60 * 60 * 1000,
    },
    areaId: null,
    unblocks,
    reason: '',
  } as unknown as QueuedGate;
}

const queue: Queue = {
  focusAreaId: null,
  ready: [entry(chat, 'review', 1), entry(dup, 'merge')],
  upNow: [],
  later: [],
  held: [],
  working: [tools],
  waiting: [],
};

describe('describeBriefingPrompt', () => {
  test('gives the model ids, titles and what each decision really is', () => {
    const prompt = describeBriefingPrompt(state, queue, NOW);
    expect(prompt).toContain('- id t-chat: “Embedded chat rework”. review: built, checks passed');
    expect(prompt).toContain('Not merged, no pull request yet');
    expect(prompt).toContain('unblocks “Tool calls in chat”');
    expect(prompt).toContain('- id t-dup: “Fix code-first duplicate”. merge: the pull request is open');
    expect(prompt).toContain('high priority');
    expect(prompt).toContain('waiting 3 hours');
    expect(prompt).toContain('- “Tool calls in chat” (building)');
  });

  test('never tells the model about decisions outside the focus', () => {
    const prompt = describeBriefingPrompt(state, { ...queue, held: [entry(tools, 'review')] }, NOW);
    expect(prompt).not.toContain('outside');
    expect(prompt).not.toContain('t-tools');
  });
});

describe('resolveBriefing', () => {
  test('falls back to the ranked queue when the model is unavailable', async () => {
    const briefing = await resolveBriefing(state, queue, NOW);
    expect(briefing.now?.taskId).toBe('t-chat');
    expect(briefing.next.map((item) => item.taskId)).toEqual(['t-dup']);
    expect(briefing.running).toBe('An agent is building “Tool calls in chat”.');
  });

  test('leaves a paused task the guide already lists out of the note', async () => {
    const paused = entry(dup, 'question', 0, 'failure');
    const briefing = await resolveBriefing(
      state,
      { ...queue, ready: [entry(chat, 'review', 1), paused] },
      NOW
    );
    expect(briefing.next.map((item) => item.taskId)).toEqual(['t-dup']);
    expect(briefing.note).toBeNull();
  });
});

describe('what the model is told', () => {
  test('ages, gate kinds, the focus, idle agents and waiting work', () => {
    const waiting = { ...tools, id: 't-wait', title: 'Later work', blockedBy: ['t-chat'] } as Task;
    const orphan = { ...tools, id: 't-orphan', title: 'Orphan', blockedBy: ['gone'] } as Task;
    const prompt = describeBriefingPrompt(
      { ...state, areas: { a1: { name: 'Superwall' } } } as unknown as ShinsaState,
      {
        ...queue,
        focusAreaId: 'a1',
        ready: [
          entry(chat, 'spec', 0, 'decision', 0),
          entry(chat, 'review'),
          entry(dup, 'question', 0, 'agent_question', 1),
          entry(tools, 'question', 0, 'decision', 72),
          entry({ ...tools, id: 't-q2', repoId: null } as Task, 'merge', 0, 'failure'),
        ],
        working: [],
        waiting: [waiting, orphan],
      },
      NOW
    );
    expect(prompt).toContain('Focus: Superwall.');
    expect(prompt).toContain(
      'plan approval: the plan is written, nothing is built yet; opened under an hour ago'
    );
    expect(prompt).not.toContain('review: built');
    expect(prompt).toContain('an agent asks: Decide; waiting 1 hour;');
    expect(prompt).toContain('question: Decide; waiting 3 days');
    expect(prompt).toContain('paused after a failure, needs a decision: Decide; waiting 3 hours.');
    expect(prompt).toContain('(nothing)');
    expect(prompt).toContain('- “Later work”, not started: waiting for “Embedded chat rework” to finish');
    expect(prompt).toContain('waiting for “another task” to finish');
  });
});

describe('the model answer', () => {
  test('a valid answer becomes the guide, and nothing to decide skips the model', async () => {
    const asked: string[] = [];
    const ask: QuickJson = <T>(_system: string, prompt: string) => {
      asked.push(prompt);
      return Promise.resolve({
        now: { task: 't-dup', why: 'The pull request is ready.' },
        next: [{ task: 't-chat', why: 'It unblocks the tool calls.' }],
        note: null,
      } as T);
    };
    const briefing = await resolveBriefing(state, queue, NOW, ask);
    expect(briefing.now?.taskId).toBe('t-dup');
    expect(asked).toHaveLength(1);
    await resolveBriefing(state, { ...queue, ready: [] }, NOW, ask);
    expect(asked).toHaveLength(1);
  });
});

describe('Briefings', () => {
  test('a burst of requests writes one briefing, and nothing after stop', async () => {
    const { engine, dispatched } = createStubEngine();
    const briefings = new Briefings(engine, { debounceMs: 10 });
    briefings.schedule();
    briefings.schedule();
    await until('the briefing', () => dispatched.length === 1);
    await Bun.sleep(30);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ type: 'briefing.write', areaId: null });
    briefings.schedule();
    briefings.stop();
    briefings.schedule();
    await Bun.sleep(30);
    expect(dispatched).toHaveLength(1);
    new Briefings(engine).stop();
  });

  test('a briefing that cannot be written is logged and the next one still runs', async () => {
    const { engine, dispatched, reject } = createStubEngine();
    reject(() => dispatched.length === 1);
    const briefings = new Briefings(engine, { debounceMs: 5 });
    briefings.schedule();
    await until('the first attempt', () => dispatched.length === 1);
    briefings.schedule();
    await until('the second attempt', () => dispatched.length === 2);
    briefings.stop();
  });
});
