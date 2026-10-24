import { describe, expect, jest, spyOn, test } from 'bun:test';
import type { GateType, Queue, QueuedGate, ShinsaState, Task } from '@shinsa/core';
import type { JsonSchema } from '../../src/agents/providers/index.ts';
import type { QuickJson } from '../../src/agents/quick/index.ts';
import { Briefings, describeBriefingPrompt, resolveBriefing } from '../../src/briefing/index.ts';
import { log } from '../../src/log/index.ts';
import { until } from '../helpers/index.ts';
import { createGate, createStubEngine, createTask } from '../helpers/state.ts';

const NOW = 5 * 24 * 60 * 60 * 1000;

const silent: QuickJson = <T>() => Promise.resolve(null as T);

const chat = {
  id: 't-chat',
  title: 'Embedded chat rework',
  waitsOn: [],
  stage: 'awaiting_review',
  priority: 'normal',
  repoId: 'r1',
  pullRequest: null,
} as unknown as Task;
const tools = {
  id: 't-tools',
  title: 'Tool calls in chat',
  waitsOn: ['t-chat'],
  stage: 'building',
  priority: 'normal',
  repoId: 'r1',
  pullRequest: null,
} as unknown as Task;
const dup = {
  id: 't-dup',
  title: 'Fix code-first duplicate',
  waitsOn: [],
  stage: 'awaiting_merge',
  priority: 'high',
  repoId: 'r1',
  pullRequest: { number: 42 },
} as unknown as Task;

const state = {
  tasks: { [chat.id]: chat, [tools.id]: tools, [dup.id]: dup },
  repos: { r1: { name: 'shinsa' } },
  projects: {},
} as unknown as ShinsaState;

function entry(task: Task, type: GateType, unblocks = 0, ageHours = 3) {
  return {
    task,
    gate: {
      id: `g-${task.id}`,
      type,
      title: 'Decide',
      openedAt: NOW - ageHours * 60 * 60 * 1000,
    },
    projectId: null,
    unblocks,
    reason: '',
  } as unknown as QueuedGate;
}

const queue: Queue = {
  focusProjectId: null,
  ready: [entry(chat, 'review', 1), entry(dup, 'merge')],
  upNow: [],
  later: [],
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
});

describe('resolveBriefing', () => {
  test('falls back to the ranked queue when the model is unavailable', async () => {
    const briefing = await resolveBriefing(state, queue, NOW, silent);
    expect(briefing.now?.taskId).toBe('t-chat');
    expect(briefing.next.map((item) => item.taskId)).toEqual(['t-dup']);
    expect(briefing.running).toBe('An agent is building “Tool calls in chat”.');
  });

  test('leaves a paused task the guide already lists out of the note', async () => {
    const paused = entry(dup, 'failure');
    const briefing = await resolveBriefing(
      state,
      { ...queue, ready: [entry(chat, 'review', 1), paused] },
      NOW,
      silent
    );
    expect(briefing.next.map((item) => item.taskId)).toEqual(['t-dup']);
    expect(briefing.note).toBeNull();
  });
});

describe('what the model is told', () => {
  test('ages, gate kinds, the focus, idle agents and waiting work', () => {
    const waiting = { ...tools, id: 't-wait', title: 'Later work', waitsOn: ['t-chat'] } as Task;
    const orphan = { ...tools, id: 't-orphan', title: 'Orphan', waitsOn: ['gone'] } as Task;
    const prompt = describeBriefingPrompt(
      { ...state, projects: { a1: { name: 'Superwall' } } } as unknown as ShinsaState,
      {
        ...queue,
        focusProjectId: 'a1',
        ready: [
          entry(chat, 'plan', 0, 0),
          entry(chat, 'review'),
          entry(dup, 'question', 0, 1),
          entry(tools, 'operation', 0, 72),
          entry({ ...tools, id: 't-q2', repoId: null } as Task, 'failure'),
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
    expect(prompt).toContain(
      'operation: merged, waiting for the developer to run it: Decide; waiting 3 days'
    );
    expect(prompt).toContain('paused after a failure, needs a decision: Decide; waiting 3 hours.');
    expect(prompt).toContain('(nothing)');
    expect(prompt).toContain('- “Later work”, not started: waiting for “Embedded chat rework” to finish');
    expect(prompt).toContain('waiting for “another task” to finish');
  });
});

describe('process gates in the prompt', () => {
  test('an incomplete setup and an escalated review say what they are', () => {
    const escalated = entry({ ...dup, id: 't-esc' } as Task, 'review');
    const prompt = describeBriefingPrompt(
      state,
      {
        ...queue,
        ready: [
          entry(chat, 'configuration'),
          { ...escalated, gate: { ...escalated.gate, escalation: { reason: 'rounds', rounds: 2, at: NOW } } },
        ],
        working: [],
        waiting: [],
      } as never,
      NOW
    );
    expect(prompt).toContain('the setup needs fixing before any work starts: Decide;');
    const signIn = describeBriefingPrompt(
      state,
      { ...queue, ready: [entry(chat, 'sign_in')], working: [], waiting: [] },
      NOW
    );
    expect(signIn).toContain('paused until the developer signs in again: Decide;');
    expect(signIn).not.toContain('Claude');
    expect(signIn).not.toContain('question: Decide');
    expect(prompt).toContain(
      'review: the agents could not settle the review, the developer decides on the findings;'
    );
  });

  test('a proposed change says the developer approves it or keeps the task as it is, and a secret is an agent asking', () => {
    const prompt = describeBriefingPrompt(
      state,
      { ...queue, ready: [entry(chat, 'proposal'), entry(dup, 'secret')], working: [], waiting: [] },
      NOW
    );
    expect(prompt).toContain(
      'proposal: an agent proposes turning this task into a change; the developer approves or keeps it as it is;'
    );
    expect(prompt).toContain('- id t-dup: “Fix code-first duplicate”. an agent asks: Decide;');
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

  test('the task of each item is a typed choice among the listed decisions, each named with its title', async () => {
    const schemas: (JsonSchema | undefined)[] = [];
    const prompts: string[] = [];
    const ask: QuickJson = <T>(_system: string, prompt: string, schema?: JsonSchema) => {
      prompts.push(prompt);
      schemas.push(schema);
      return Promise.resolve(null as T);
    };
    await resolveBriefing(state, { ...queue, ready: [...queue.ready, entry(chat, 'plan')] }, NOW, ask);
    const task = { type: 'string', enum: ['t-chat', 't-dup'] };
    const item = {
      type: 'object',
      properties: { task, why: { type: 'string' } },
      required: ['task', 'why'],
      additionalProperties: false,
    };
    expect(schemas[0]).toEqual({
      type: 'object',
      properties: {
        now: item,
        next: { type: 'array', items: item, maxItems: 3 },
        note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['now', 'next', 'note'],
      additionalProperties: false,
    });
    expect(prompts[0]).toEndWith(
      'The task field:\n- task (choice): The decision an item of the guide is about, for now.task and every next[].task. Options: "t-chat": “Embedded chat rework”; "t-dup": “Fix code-first duplicate”. Answer with exactly one option, copied exactly.'
    );
  });

  test('an answer that picks a task outside the decisions falls back to the ranked queue', async () => {
    const ask: QuickJson = <T>() =>
      Promise.resolve({ now: { task: 't-tools', why: 'It is building.' }, next: [], note: null } as T);
    const briefing = await resolveBriefing(state, queue, NOW, ask);
    expect(briefing.now?.taskId).toBe('t-chat');
    expect(briefing.next.map((item) => item.taskId)).toEqual(['t-dup']);
  });
});

describe('Briefings', () => {
  test('a burst of requests writes one briefing', async () => {
    const { engine, state: live, dispatched, commandIds } = createStubEngine();
    const briefings = new Briefings(engine, { ask: silent, debounceMs: 10 });
    briefings.schedule();
    briefings.schedule();
    await until('the briefing', () => dispatched.length === 1);
    live.seq = 1;
    briefings.schedule();
    await until('the next briefing', () => dispatched.length === 2);
    briefings.stop();
    expect(commandIds).toEqual(['briefing:*:0', 'briefing:*:1']);
    expect(dispatched[0]).toMatchObject({ type: 'briefing.write', projectId: null });
  });

  test('nothing is written once the briefings stop, not even a write already waiting on the model', async () => {
    const { engine, dispatched, update } = createStubEngine();
    jest.useFakeTimers();
    try {
      const idle = new Briefings(engine, { ask: silent });
      idle.schedule();
      idle.stop();
      idle.schedule();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
    const answers: ((value: null) => void)[] = [];
    const ask: QuickJson = <T>() => {
      return new Promise<T>((resolve) => {
        answers.push(resolve as (value: null) => void);
      });
    };
    update((draft) => {
      draft.tasks['task-1'] = createTask({ id: 'task-1' });
      draft.gates['gate-1'] = createGate();
    });
    const dropped = spyOn(log, 'info');
    const briefings = new Briefings(engine, { ask, debounceMs: 1 });
    briefings.schedule();
    await until('the model to be asked', () => answers.length === 1);
    briefings.stop();
    answers[0]?.(null);
    await until('the write to be dropped', () => dropped.mock.calls.length > 0);
    dropped.mockRestore();
    expect(dispatched).toEqual([]);
  });

  test('a briefing is written under an id from the state it was computed from and the focus', async () => {
    const {
      engine,
      state: live,
      dispatched,
      commandIds,
    } = createStubEngine((draft) => {
      draft.seq = 7;
    });
    const briefings = new Briefings(engine, { ask: silent, debounceMs: 1 });
    briefings.schedule();
    await until('the first briefing', () => dispatched.length === 1);
    briefings.schedule();
    await until('the repeat', () => dispatched.length === 2);
    live.seq = 9;
    live.focus = { projectId: 'a1', until: null };
    briefings.schedule();
    await until('the next briefing', () => dispatched.length === 3);
    briefings.stop();
    expect(commandIds).toEqual(['briefing:*:7', 'briefing:*:7', 'briefing:a1:9']);
  });

  test('a briefing that cannot be written is logged and the next one still runs', async () => {
    const { engine, dispatched, reject } = createStubEngine();
    reject(() => dispatched.length === 1);
    const briefings = new Briefings(engine, { ask: silent, debounceMs: 5 });
    briefings.schedule();
    await until('the first attempt', () => dispatched.length === 1);
    briefings.schedule();
    await until('the second attempt', () => dispatched.length === 2);
    briefings.stop();
  });
});
