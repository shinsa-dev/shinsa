import { afterEach, describe, expect, test } from 'bun:test';
import {
  type GateType,
  NO_FOCUS,
  NO_FOCUS_PROJECTS,
  type Queue,
  type QueuedGate,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { Context, Deferred, Duration, Effect, Exit, Layer, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import type { JsonSchema } from '../../src/agents/providers/index.ts';
import type { QuickJson } from '../../src/agents/quick/schema.ts';
import { QuickCalls } from '../../src/agents/quick/service.ts';
import { describeBriefingPrompt } from '../../src/briefing/prompt.ts';
import { resolveBriefingAnswer } from '../../src/briefing/resolve.ts';
import { BriefingDebounce } from '../../src/briefing/schema.ts';
import { BriefingWriter } from '../../src/briefing/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { createStubEngineCoreLayer } from '../helpers/engine-core.ts';
import { captureLogs } from '../helpers/logs.ts';
import { createGate, createStubEngine, createTask, type StubEngine } from '../helpers/state.ts';
import { until } from '../helpers/until.ts';

function resolveBriefing(state: ShinsaState, queue: Queue, now: number, ask: QuickJson) {
  return Effect.runPromise(resolveBriefingAnswer(state, queue, now, ask));
}

const scopes: Scope.Closeable[] = [];

afterEach(async () => {
  for (const scope of scopes.splice(0)) await Effect.runPromise(Scope.close(scope, Exit.void));
});

function createWriterLayer(stub: StubEngine, ask: QuickJson, debounce?: Duration.Duration) {
  return BriefingWriter.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        createStubEngineCoreLayer(stub),
        Layer.succeed(QuickCalls, QuickCalls.of({ classify: ask, write: ask })),
        debounce ? Layer.succeed(BriefingDebounce, debounce) : Layer.empty
      )
    )
  );
}

function openWriter(stub: StubEngine, ask: QuickJson, debounce = Duration.millis(10)) {
  const scope = Scope.makeUnsafe();
  scopes.push(scope);
  const writer = Effect.runSync(
    Layer.buildWithScope(createWriterLayer(stub, ask, debounce), scope).pipe(
      Effect.map((context) => Context.get(context, BriefingWriter))
    )
  );
  const run = (effect: Effect.Effect<void>) => Effect.runSync(effect.pipe(Effect.provide(JsonLogger)));
  return { schedule: () => run(writer.schedule), stop: () => run(writer.stop) };
}

const NOW = 5 * 24 * 60 * 60 * 1000;

const silent: QuickJson = <T>() => Effect.succeed(null as T);

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
  focus: NO_FOCUS_PROJECTS,
  focusTeamId: null,
  ready: [entry(chat, 'review', 1), entry(dup, 'merge')],
  upNow: [],
  later: [],
  working: [tools],
  waiting: [],
  backlog: [],
  snoozed: [],
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
  test('fails with the reason when the writer cannot be reached', async () => {
    const offline: QuickJson = () => Effect.die(new Error('writer offline'));
    await expect(resolveBriefing(state, queue, NOW, offline)).rejects.toThrow('writer offline');
  });

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
        focus: { projectIds: ['a1'], except: false },
        ready: [
          entry(chat, 'plan', 0, 0),
          entry(chat, 'review'),
          entry(dup, 'question', 0, 1),
          entry(tools, 'operation', 0, 72),
          entry({ ...tools, id: 't-q2', repoId: null } as Task, 'failure'),
          entry({ ...tools, id: 't-steps' } as Task, 'post_merge'),
          entry({ ...tools, id: 't-read' } as Task, 'result'),
        ],
        working: [],
        waiting: [waiting, orphan],
      },
      NOW
    );
    expect(prompt).toContain('Focus: Superwall.');
    const allBut = describeBriefingPrompt(
      { ...state, projects: { a1: { name: 'Superwall' }, a2: { name: 'Work' } } } as unknown as ShinsaState,
      { ...queue, focus: { projectIds: ['a2'], except: true } },
      NOW
    );
    expect(allBut).toContain('Focus: everything but Work.');
    expect(describeBriefingPrompt(state, queue, NOW)).toContain('No focus set.');
    expect(prompt).toContain(
      'plan approval: the plan is written, nothing is built yet; opened under an hour ago'
    );
    expect(prompt).not.toContain('review: built');
    expect(prompt).toContain('an agent asks: Decide; waiting 1 hour;');
    expect(prompt).toContain(
      'operation: merged, waiting for the developer to run it: Decide; waiting 3 days'
    );
    expect(prompt).toContain('paused after a failure, needs a decision: Decide; waiting 3 hours.');
    expect(prompt).toContain(
      'after the merge: merged, and the task is done once the developer does the steps it left them: Decide'
    );
    expect(prompt).toContain(
      'answered: the answer, report or diagnosis is ready, and the task is done once the developer reads and closes it: Decide'
    );
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
      return Effect.succeed({
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
      return Effect.succeed(null as T);
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
      Effect.succeed({ now: { task: 't-tools', why: 'It is building.' }, next: [], note: null } as T);
    const briefing = await resolveBriefing(state, queue, NOW, ask);
    expect(briefing.now?.taskId).toBe('t-chat');
    expect(briefing.next.map((item) => item.taskId)).toEqual(['t-dup']);
  });
});

describe('the briefing writer', () => {
  test('a burst of requests writes one briefing, kept for the focus project', async () => {
    const stub = createStubEngine();
    const briefings = openWriter(stub, silent);
    briefings.schedule();
    briefings.schedule();
    await until('the briefing', () => stub.briefed.length === 1);
    stub.state.focus = { ...NO_FOCUS, projectIds: ['a1'] };
    briefings.schedule();
    await until('the next briefing', () => stub.briefed.length === 2);
    briefings.stop();
    expect(stub.briefed.map((written) => written.key)).toEqual(['*', 'a1']);
    expect(stub.briefed[0]).toMatchObject({ text: expect.any(String), briefing: { now: null, next: [] } });
  });

  test('a request after the briefings stop waits for nothing and writes nothing', async () => {
    const stub = createStubEngine();
    await Effect.runPromise(
      BriefingWriter.use((idle) =>
        Effect.gen(function* () {
          yield* idle.schedule;
          yield* idle.stop;
          yield* idle.schedule;
          yield* TestClock.adjust('1 minute');
        })
      ).pipe(Effect.provide(Layer.mergeAll(createWriterLayer(stub, silent), TestClock.layer(), JsonLogger)))
    );
    expect(stub.briefed).toEqual([]);
  });

  test('nothing is written once the briefings stop, not even a write already waiting on the model', async () => {
    const stub = createStubEngine();
    const answer = Effect.runSync(Deferred.make<null>());
    let asked = 0;
    const ask: QuickJson = <T>() =>
      Effect.suspend(() => {
        asked += 1;
        return Deferred.await(answer) as Effect.Effect<T | null>;
      });
    stub.update((draft) => {
      draft.tasks['task-1'] = createTask({ id: 'task-1' });
      draft.gates['gate-1'] = createGate();
    });
    const logs = captureLogs();
    try {
      const briefings = openWriter(stub, ask, Duration.millis(1));
      briefings.schedule();
      await until('the model to be asked', () => asked === 1);
      briefings.stop();
      Effect.runSync(Deferred.succeed(answer, null));
      const dropped = '[Briefing] Dropped a briefing that was written after the server stopped';
      await until('the write to be dropped', () => logs.fieldsOf(dropped).length > 0);
    } finally {
      logs.restore();
    }
    expect(stub.briefed).toEqual([]);
  });

  test('a briefing that cannot be written is logged and the next one still runs', async () => {
    const stub = createStubEngine();
    stub.refuseBriefing(() => stub.briefed.length === 1);
    const logs = captureLogs();
    try {
      const briefings = openWriter(stub, silent, Duration.millis(5));
      briefings.schedule();
      await until('the first attempt', () => stub.briefed.length === 1);
      briefings.schedule();
      await until('the second attempt', () => stub.briefed.length === 2);
      briefings.stop();
      expect(logs.fieldsOf('[Briefing] Could not write the briefing')).toEqual([{ error: 'rejected' }]);
    } finally {
      logs.restore();
    }
  });
});
