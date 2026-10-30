import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createState,
  listActiveRuns,
  type PlanDocument,
  type Round,
  resolveCurrentRound,
  resolveTaskRounds,
  SHAPE_PIPELINES,
  type TaskShape,
  type UserCommand,
} from '@shinsa/core';
import type { JsonSchema } from '../../src/agents/providers/index.ts';
import type { QuickJson } from '../../src/agents/quick/index.ts';
import { Engine } from '../../src/runtime/engine.ts';
import { EventLog } from '../../src/store/index.ts';
import { MessageInbox } from '../../src/triage/inbox.ts';
import {
  type Classifier,
  createClassifier,
  type MessageClass,
  type MessageClassifier,
  resolveMessageClass,
  resolveMessageRoute,
  resolveRoundRepository,
  resolveRoundShape,
  routeUserCommand,
  type ShapeClassifier,
} from '../../src/triage/message.ts';
import { until } from '../helpers/index.ts';
import { createRepo, createTask } from '../helpers/state.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function answer(value: unknown): QuickJson {
  return <T>() => Promise.resolve(value as T);
}

async function openEngine() {
  const dir = mkdtempSync(join(tmpdir(), 'shinsa-message-'));
  dirs.push(dir);
  const engine = new Engine(new EventLog(join(dir, 'shinsa.sqlite')));
  await engine.dispatch({ type: 'task.create', request: 'Add MCP v2', repoId: null });
  const taskId = Object.keys(engine.state.tasks)[0] ?? '';
  return { engine, taskId };
}

const notAsked = () => Promise.reject(new Error('not asked'));

function using(classifyMessage: MessageClassifier, shape: ShapeClassifier = notAsked): Classifier {
  return { message: classifyMessage, shape };
}

function message(taskId: string, text = 'Also add search'): Extract<UserCommand, { type: 'task.message' }> {
  return { type: 'task.message', taskId, text };
}

describe('reading what a message asks for', () => {
  test('asks the classifier one typed choice among feedback, new work and another task, with the task’s rounds', async () => {
    const asked: { system: string; prompt: string; schema: JsonSchema | undefined }[] = [];
    const ask: QuickJson = <T>(system: string, prompt: string, schema?: JsonSchema) => {
      asked.push({ system, prompt, schema });
      return Promise.resolve({
        kind: 'new_round',
        shape: 'fix',
        title: ' Add search ',
        why: ' New work. ',
      } as T);
    };
    const task = createTask({
      title: 'Add MCP v2',
      request: 'Add MCP v2\nwith tools',
      stageReason: 'building',
    });
    expect(await resolveMessageClass(task, 'Also add search', ask)).toEqual({
      kind: 'new_round',
      title: 'Add search',
      why: 'New work.',
      shape: 'fix',
    });
    const [call] = asked;
    expect(call?.schema).toMatchObject({
      required: ['why', 'kind', 'shape', 'title'],
      properties: {
        kind: { type: 'string', enum: ['acknowledge', 'feedback', 'new_round', 'separate_task'] },
      },
    });
    expect(call?.system).toContain('A task is a conversation that runs in rounds');
    expect(call?.system).toContain('Most messages need no new work.');
    expect(call?.prompt).toContain(
      'Task: Add MCP v2\nIt started from: Add MCP v2\nIts rounds:\n- Round 1: Add MCP v2 (change, in progress).'
    );
    expect(call?.prompt).toContain('Now: round 1 is in progress, building.');
    expect(call?.prompt).toContain('A round of this task is in progress. What is this message?');
    expect(call?.prompt).toContain(
      'including its files, its steps around the merge and what it needs in other repositories'
    );
    expect(call?.prompt).toContain('Message:\nAlso add search');
  });

  test.each([
    ['awaiting_merge', 'merge'],
    ['awaiting_review', 'review'],
  ] as const)(
    'a round waiting at your %s asks whether the message is about that round',
    async (stage, decision) => {
      const asked: string[] = [];
      const ask: QuickJson = <T>(_system: string, prompt: string) => {
        asked.push(prompt);
        return Promise.resolve({
          kind: 'feedback',
          shape: 'answer',
          title: 'Dev server',
          why: 'To try it.',
        } as T);
      };
      const task = createTask({ title: 'Add MCP v2', stage, stageReason: 'waiting for you' });
      expect(
        await resolveMessageClass(task, 'Can you start the dev server so I can test the UI?', ask)
      ).toEqual({
        kind: 'feedback',
        title: 'Dev server',
        why: 'To try it.',
        shape: 'answer',
      });
      const [read] = asked;
      expect(read).toContain(`Now: round 1 is finished and waits for the human to ${decision} it.`);
      expect(read).toContain(
        `The work of the current round is finished and waits for the human to ${decision} it. Nothing else is in progress. What is this message?`
      );
      expect(read).toContain(
        `"feedback": about this round before the ${decision}: a change to it, something to run or start for it so the human can try it (a dev server, a service, a script)`
      );
      expect(read).toContain('not something needed to try or finish this round');
      expect(read).toContain(
        'its files, its steps around the merge and what it needs in other repositories (even when the message names another checkout)'
      );
      expect(read).toContain(
        `"separate_task": asks for work toward another goal, which belongs in a task of its own; a message about this task's own work, its files, its steps or the parts it needs in other repositories is not this, even when it names another repository or checkout`
      );
    }
  );

  test('an answer outside the options, or none, leaves the message to Shinsa’s default', async () => {
    const task = createTask();
    expect(await resolveMessageClass(task, 'x', answer(null))).toBeNull();
    expect(await resolveMessageClass(task, 'x', answer({ kind: 'maybe' }))).toBeNull();
    expect(
      await resolveMessageClass(task, 'x', answer({ kind: 'feedback', shape: 'deploy', title: 3, why: '' }))
    ).toEqual({
      kind: 'feedback',
      title: null,
      why: null,
      shape: null,
    });
    const classify = createClassifier(
      answer({ kind: 'separate_task', shape: 'change', title: 'Billing', why: 'Elsewhere.' })
    );
    expect(await classify.message(task, 'Redo billing')).toMatchObject({
      kind: 'separate_task',
      title: 'Billing',
    });
    expect(await classify.shape(task, 'Redo billing')).toBe('change');
  });
});

async function routed(
  engine: Engine,
  command: UserCommand,
  id: string | null,
  classify: MessageClassifier | null
) {
  const inbox = classify ? new MessageInbox(engine, classify) : null;
  inbox?.start();
  const events = await routeUserCommand(engine, command, id, classify ? using(classify) : null);
  await inbox?.settle();
  inbox?.stop();
  return events;
}

describe('routing a command through the classifier', () => {
  test('a message is accepted before the classifier answers, and routed once it does', async () => {
    const { engine, taskId } = await openEngine();
    let release: (value: MessageClass) => void = () => undefined;
    const classify: MessageClassifier = () => {
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const inbox = new MessageInbox(engine, classify);
    inbox.start();
    const accepted = await routeUserCommand(engine, message(taskId), 'client:1', using(classify));
    expect(accepted.map((event) => event.type)).toEqual(['task.message_received']);
    expect(engine.state.tasks[taskId]?.inbox?.map((entry) => entry.text)).toEqual(['Also add search']);
    release({ kind: 'new_round', title: 'Search', why: 'New work.', shape: 'change' });
    await inbox.settle();
    inbox.stop();
    expect(engine.state.tasks[taskId]?.inbox).toEqual([]);
    expect(resolveTaskRounds(engine.state.tasks[taskId] ?? createTask())[1]).toMatchObject({
      title: 'Search',
      why: 'New work.',
    });
    expect(await routeUserCommand(engine, message(taskId), 'client:1', using(classify))).toEqual(accepted);
  });

  test('feedback keeps no shape, and a message the classifier cannot read stays feedback', async () => {
    const { engine, taskId } = await openEngine();
    await routed(engine, message(taskId, 'Use tabs'), null, () =>
      Promise.resolve({ kind: 'feedback', title: null, why: null, shape: 'fix' })
    );
    await routed(engine, message(taskId, 'Hmm'), null, () => Promise.resolve(null));
    const entries = engine.state.tasks[taskId]?.activity.filter((entry) => entry.kind === 'message') ?? [];
    expect(entries.map((entry) => entry.detail)).toEqual(['Use tabs', 'Hmm']);
    expect(resolveTaskRounds(engine.state.tasks[taskId] ?? createTask())).toHaveLength(1);
  });

  test('a command that is not a message, one that says what it is, or one without a classifier goes straight in', async () => {
    const { engine, taskId } = await openEngine();
    const never = using(notAsked);
    await routeUserCommand(engine, { type: 'task.prioritize', taskId, priority: 'high' }, null, never);
    await routeUserCommand(engine, { ...message(taskId), kind: 'new_round', shape: 'answer' }, null, never);
    await routeUserCommand(engine, { ...message(taskId), kind: 'feedback' }, null, never);
    await routeUserCommand(engine, message(taskId, 'Plain'), null, null);
    expect(engine.state.tasks[taskId]?.priority).toBe('high');
    expect(engine.state.tasks[taskId]?.inbox).toBeUndefined();
    expect(resolveTaskRounds(engine.state.tasks[taskId] ?? createTask())).toHaveLength(2);
  });

  test('a message to a finished or missing task is refused before it reaches the inbox', async () => {
    const { engine, taskId } = await openEngine();
    await engine.dispatch({ type: 'task.cancel', taskId });
    const never = using(notAsked);
    await expect(routeUserCommand(engine, message(taskId), null, never)).rejects.toThrow(
      'This task is finished.'
    );
    await expect(routeUserCommand(engine, message('gone'), null, never)).rejects.toThrow('No task gone');
  });
});

describe('new work the classifier reads', () => {
  test('work for another task becomes a round that investigates first when the classifier read a fix and the task has no room for suggestions', async () => {
    const { engine, taskId } = await openEngine();
    for (let index = 0; index < 10; index += 1) {
      await engine.dispatch({ ...message(taskId, `Idea ${index}`), kind: 'separate_task' });
    }
    const classify: MessageClassifier = () =>
      Promise.resolve({ kind: 'separate_task', title: 'Redo billing', why: 'Elsewhere.', shape: 'fix' });
    await routed(engine, message(taskId, 'Redo billing'), null, classify);
    const rounds = resolveTaskRounds(engine.state.tasks[taskId] ?? createTask());
    expect(rounds.at(-1)).toMatchObject({ title: 'Redo billing', status: 'waiting' });
    expect(rounds.at(-1)?.pipeline[0]).toBe('investigate');
  });

  test('two sends of one message under the same id are accepted once and classified once', async () => {
    const { engine, taskId } = await openEngine();
    let asked = 0;
    const classify: MessageClassifier = () => {
      asked += 1;
      return Promise.resolve({ kind: 'new_round', title: 'Search', why: 'New work.', shape: 'change' });
    };
    const inbox = new MessageInbox(engine, classify);
    inbox.start();
    const [landed, repeated] = await Promise.all([
      routeUserCommand(engine, message(taskId), 'client:7', using(classify)),
      routeUserCommand(engine, message(taskId), 'client:7', using(classify)),
    ]);
    await inbox.settle();
    inbox.stop();
    expect(repeated).toEqual(landed);
    expect(asked).toBe(1);
    expect(resolveTaskRounds(engine.state.tasks[taskId] ?? createTask())).toHaveLength(2);
  });
});

describe('a round that starts without a kind of task', () => {
  function shapeAs(shape: TaskShape | null, asked: string[] = []): ShapeClassifier {
    return (_task, request) => {
      asked.push(request);
      return Promise.resolve(shape);
    };
  }

  function lastPipeline(engine: Engine, taskId: string) {
    return resolveTaskRounds(engine.state.tasks[taskId] ?? createTask()).at(-1)?.pipeline;
  }

  async function suggest(engine: Engine, taskId: string) {
    await engine.dispatch({ ...message(taskId, 'Why is the import slow?'), kind: 'separate_task' });
    return engine.state.tasks[taskId]?.suggestions?.at(-1)?.id ?? '';
  }

  test('asks the classifier one kind-of-task choice for the request, with the task’s rounds', async () => {
    const asked: { system: string; prompt: string; schema: JsonSchema | undefined }[] = [];
    const ask: QuickJson = <T>(system: string, prompt: string, schema?: JsonSchema) => {
      asked.push({ system, prompt, schema });
      return Promise.resolve({ shape: 'research' } as T);
    };
    const task = createTask({ title: 'Add MCP v2', request: 'Add MCP v2', stageReason: 'building' });
    expect(await resolveRoundShape(task, 'Compare the SDKs', ask)).toBe('research');
    const [call] = asked;
    expect(call?.schema).toMatchObject({ required: ['shape'], properties: { shape: { type: 'string' } } });
    expect(call?.system).toContain('decide what kind of work it is');
    expect(call?.prompt).toContain('Its rounds:\n- Round 1: Add MCP v2 (change, in progress).');
    expect(call?.prompt).toContain('Request for the next round:\nCompare the SDKs');
    expect(call?.prompt).toContain('What kind of task is this round?');
    expect(await resolveRoundShape(task, 'x', answer({ shape: 'deploy' }))).toBeNull();
    expect(await resolveRoundShape(task, 'x', answer(null))).toBeNull();
  });

  test('a message sent as a new round is shaped before it lands, and a full change only when the model has no answer', async () => {
    const { engine, taskId } = await openEngine();
    const asked: string[] = [];
    await routeUserCommand(
      engine,
      { ...message(taskId, 'Why does the import hang?'), kind: 'new_round' },
      null,
      using(notAsked, shapeAs('investigate', asked))
    );
    expect(asked).toEqual(['Why does the import hang?']);
    expect(lastPipeline(engine, taskId)).toEqual([...SHAPE_PIPELINES.investigate]);
    await routeUserCommand(
      engine,
      { ...message(taskId, 'Add search'), kind: 'new_round' },
      null,
      using(notAsked, shapeAs(null))
    );
    expect(lastPipeline(engine, taskId)).toEqual([...SHAPE_PIPELINES.change]);
  });

  test('an agent’s new round is shaped too, and two sends under one id ask once and land once', async () => {
    const { engine, taskId } = await openEngine();
    const asked: string[] = [];
    const classify = using(notAsked, shapeAs('answer', asked));
    const command: UserCommand = { ...message(taskId, 'Which SDK do we use?'), kind: 'new_round' };
    const from = { onBehalf: true, byTask: null };
    const [landed, repeated] = await Promise.all([
      routeUserCommand(engine, command, 'agent:9', classify, from),
      routeUserCommand(engine, command, 'agent:9', classify, from),
    ]);
    expect(repeated).toEqual(landed);
    expect(asked).toHaveLength(1);
    expect(lastPipeline(engine, taskId)).toEqual([...SHAPE_PIPELINES.answer]);
    expect(await routeUserCommand(engine, command, 'agent:9', using(notAsked), from)).toEqual(landed);
  });

  test('a suggestion kept as the next round is shaped from its request', async () => {
    const { engine, taskId } = await restAfterOperation();
    const suggestionId = await suggest(engine, taskId);
    const asked: string[] = [];
    await routeUserCommand(
      engine,
      { type: 'suggestion.keep', taskId, suggestionId },
      null,
      using(notAsked, shapeAs('investigate', asked))
    );
    expect(asked).toEqual(['Why is the import slow?']);
    expect(lastPipeline(engine, taskId)).toEqual([...SHAPE_PIPELINES.investigate]);
  });

  test('a suggestion kept while the round is open goes to it, so it never asks', async () => {
    const { engine, taskId } = await openEngine();
    const suggestionId = await suggest(engine, taskId);
    await routeUserCommand(engine, { type: 'suggestion.keep', taskId, suggestionId }, null, using(notAsked));
    const task = engine.state.tasks[taskId] ?? createTask();
    expect(task.suggestions?.at(-1)).toMatchObject({ status: 'dismissed', keptRound: 1 });
    expect(resolveTaskRounds(task)).toHaveLength(1);
  });

  test('a suggestion kept with a kind, a closed one or an unknown one never asks', async () => {
    const { engine, taskId } = await restAfterOperation();
    const shaped = await suggest(engine, taskId);
    const never = using(notAsked);
    await routeUserCommand(
      engine,
      { type: 'suggestion.keep', taskId, suggestionId: shaped, shape: 'research' },
      null,
      never
    );
    expect(lastPipeline(engine, taskId)).toEqual([...SHAPE_PIPELINES.research]);
    await expect(
      routeUserCommand(engine, { type: 'suggestion.keep', taskId, suggestionId: shaped }, null, never)
    ).rejects.toThrow('already been added or dismissed');
    await expect(
      routeUserCommand(engine, { type: 'suggestion.keep', taskId, suggestionId: 'nope' }, null, never)
    ).rejects.toThrow('No suggestion nope');
    await expect(
      routeUserCommand(engine, { type: 'suggestion.keep', taskId: 'gone', suggestionId: 'x' }, null, never)
    ).rejects.toThrow('No task gone');
  });
});

describe('a message an agent sends for you', () => {
  test('is classified before it is dispatched, and two sends under one id ask once and land once', async () => {
    const { engine, taskId } = await openEngine();
    const answers: ((value: MessageClass) => void)[] = [];
    const classify: MessageClassifier = () => {
      return new Promise((resolve) => {
        answers.push(resolve);
      });
    };
    const from = { onBehalf: true, byTask: null };
    const first = routeUserCommand(engine, message(taskId), 'agent:7', using(classify), from);
    const second = routeUserCommand(engine, message(taskId), 'agent:7', using(classify), from);
    await until('the classifier to be asked', () => answers.length > 0);
    for (const resolve of answers)
      resolve({ kind: 'new_round', title: 'Search', why: 'New work.', shape: 'change' });
    const [landed, repeated] = await Promise.all([first, second]);
    expect(repeated).toEqual(landed);
    expect(answers).toHaveLength(1);
    expect(landed.map((event) => event.type)).toContain('round.queued');
    await routeUserCommand(
      engine,
      message(taskId, 'Unique'),
      null,
      using(() => Promise.resolve(null)),
      from
    );
    expect(engine.state.tasks[taskId]?.inbox).toBeUndefined();
  });
});

const LONG_RESULT = `Moved 39 repositories into groups.\n\n${'Each group has a README. '.repeat(30)}`;

function createRound(overrides: Partial<Round>): Round {
  return {
    number: 1,
    title: 'Restructure projects/',
    request: 'restructure projects/',
    why: null,
    shipping: 'onto_pull_request',
    status: 'finished',
    pipeline: ['plan', 'operate'],
    branch: null,
    base: null,
    pullRequest: null,
    queuedAt: 0,
    startedAt: 0,
    endedAt: 1,
    outcome: { goal: 'Group the projects.', phases: [], headline: null, result: LONG_RESULT },
    ...overrides,
  };
}

describe('reading a message to a resting task', () => {
  test('asks whether it needs nothing, a follow-up answer, a new round or another task, with what each round did', async () => {
    const asked: string[] = [];
    const ask: QuickJson = <T>(_system: string, prompt: string) => {
      asked.push(prompt);
      return Promise.resolve({ why: 'Thanks.', kind: 'acknowledge', shape: 'answer', title: 'Thanks' } as T);
    };
    const task = createTask({
      title: 'Restructure projects/',
      request: 'restructure projects/',
      stage: 'done',
      pipeline: ['plan', 'operate'],
      rounds: [
        createRound({}),
        createRound({
          number: 2,
          title: 'Explain the keys',
          pipeline: [],
          outcome: { goal: 'Explain the keys.', phases: [], headline: null, result: null },
        }),
        createRound({ number: 3, title: 'Count them', pipeline: ['answer'], outcome: null }),
      ],
    });
    expect(await resolveMessageClass(task, 'sick thank you', ask)).toEqual({
      kind: 'acknowledge',
      title: 'Thanks',
      why: 'Thanks.',
      shape: 'answer',
    });
    const [read] = asked;
    expect(read).toContain('Nothing is in progress in this task. What is this message?');
    expect(read).toContain('"acknowledge": needs nothing: thanks');
    expect(read).toContain(
      '- Round 1: Restructure projects/ (operation, finished). What it did: Moved 39 repositories into groups. Each group has a README.'
    );
    expect(read).toContain('Each group has …');
    expect(read).toContain(
      '- Round 2: Explain the keys (operation, finished). What it did: Explain the keys.'
    );
    expect(read).toContain('- Round 3: Count them (answer, finished).\n');
    expect(read).toContain('Now: round 3 is done and nothing is in progress.');
  });

  test('only new work keeps the kind of task it was read as', () => {
    const read = { title: 'Thanks', why: 'Thanks.', shape: 'change' as const };
    expect(resolveMessageRoute({ ...read, kind: 'acknowledge' })).toEqual({
      kind: 'acknowledge',
      title: 'Thanks',
      why: 'Thanks.',
    });
    expect(resolveMessageRoute({ ...read, kind: 'new_round' })).toMatchObject({ shape: 'change' });
    expect(resolveMessageRoute(null)).toEqual({});
  });
});

const OPERATION_PLAN: PlanDocument = {
  goal: 'Group the projects.',
  phases: [{ title: 'Move the folders', detail: 'Move each repository into its group.' }],
  behaviour: ['Every repository sits in a group.'],
  approach: 'Move, then list.',
  files: [],
  outOfScope: [],
  verification: [],
  questions: [],
  impact: 'Moves 39 folders; the dry run lists them. Undo by moving them back.',
};

function activeRunOf(engine: Engine, taskId: string) {
  const [run] = listActiveRuns(engine.state, taskId);
  if (!run) throw new Error('no active run');
  return run;
}

async function restAfterOperation() {
  const dir = mkdtempSync(join(tmpdir(), 'shinsa-message-'));
  dirs.push(dir);
  const engine = new Engine(new EventLog(join(dir, 'shinsa.sqlite')));
  await engine.dispatch({
    type: 'repo.register',
    repo: {
      name: 'projects',
      path: '/code/projects',
      defaultBranch: 'main',
      remote: null,
      checkCommands: [],
    },
    projectName: null,
  });
  const repoId = Object.keys(engine.state.repos)[0] ?? '';
  await engine.dispatch({ type: 'task.create', request: 'restructure projects/', repoId: null });
  const taskId = Object.keys(engine.state.tasks)[0] ?? '';
  await engine.dispatch({
    type: 'task.triage',
    taskId,
    title: 'Restructure projects/',
    repoId,
    size: 'small',
    branch: 'chore/restructure-projects',
    waitsOn: [],
    shape: 'operation',
  });
  await engine.dispatch({ type: 'config.record', taskId, problems: [] });
  await engine.dispatch({
    type: 'worktree.ready',
    taskId,
    path: '/wt/projects',
    branch: 'chore/restructure-projects',
  });
  await engine.dispatch({
    type: 'agent.propose_plan',
    runId: activeRunOf(engine, taskId).id,
    document: OPERATION_PLAN,
  });
  const gate = Object.values(engine.state.gates).find((candidate) => candidate.status === 'open');
  await engine.dispatch({ type: 'gate.answer', gateId: gate?.id ?? '', decision: 'approve', response: null });
  await engine.dispatch({
    type: 'run.link',
    runId: activeRunOf(engine, taskId).id,
    sessionId: 'operator-1',
    provider: 'claude',
  });
  await engine.dispatch({
    type: 'agent.deliver',
    runId: activeRunOf(engine, taskId).id,
    step: 'operate',
    body: 'Moved 39 repositories into groups.',
  });
  return { engine, taskId };
}

function classifyAs(found: MessageClass | null): MessageClassifier {
  return () => Promise.resolve(found);
}

describe('routing a message to a resting task', () => {
  test('thanks starts no round and no agent', async () => {
    const { engine, taskId } = await restAfterOperation();
    expect(engine.state.tasks[taskId]?.stage).toBe('done');
    const runs = Object.keys(engine.state.runs).length;
    await routed(
      engine,
      message(taskId, 'sick thank you'),
      'client:thanks',
      classifyAs({ kind: 'acknowledge', title: 'Thanks', why: 'Thanks.', shape: 'change' })
    );
    const task = engine.state.tasks[taskId];
    expect(task?.stage).toBe('done');
    expect(resolveTaskRounds(task ?? createTask())).toHaveLength(1);
    expect(Object.keys(engine.state.runs)).toHaveLength(runs);
    expect(task?.activity.at(-1)).toMatchObject({ text: 'Sent a message', detail: 'sick thank you' });
  });

  test('a question about the work, or a message the classifier cannot read, resumes the last session in the same round', async () => {
    for (const found of [
      { kind: 'feedback' as const, title: null, why: 'A question about the key.', shape: 'answer' as const },
      null,
    ]) {
      const { engine, taskId } = await restAfterOperation();
      await routed(engine, message(taskId, 'Why did you pick SW as the key?'), null, classifyAs(found));
      const task = engine.state.tasks[taskId] ?? createTask();
      expect(task.stage).toBe('answering');
      expect(resolveTaskRounds(task)).toHaveLength(1);
      expect(resolveCurrentRound(task).number).toBe(1);
      expect(activeRunOf(engine, taskId)).toMatchObject({
        role: 'answerer',
        sessionId: 'operator-1',
        provider: 'claude',
      });
    }
  });

  test('a real new request starts a new round shaped by the classifier, here an answer', async () => {
    const { engine, taskId } = await restAfterOperation();
    await routed(
      engine,
      message(taskId, 'How many repositories ended up in Archive?'),
      null,
      classifyAs({
        kind: 'new_round',
        title: 'Count the archived repositories',
        why: 'A new question.',
        shape: 'answer',
      })
    );
    const task = engine.state.tasks[taskId] ?? createTask();
    expect(resolveCurrentRound(task)).toMatchObject({
      number: 2,
      title: 'Count the archived repositories',
      pipeline: ['answer'],
      status: 'active',
    });
    expect(task.pipeline).toEqual(['answer']);
  });
});

describe('finding the repository a round needs', () => {
  const LOCAL = [
    { path: '/code/shinsa', name: 'shinsa', touchedAt: 2 },
    { path: '/code/kanna', name: 'kanna', touchedAt: 1 },
  ];

  function unbound() {
    return createTask({
      repoId: null,
      worktreePath: null,
      branch: null,
      title: 'Hey',
      request: 'Hey',
      stage: 'triage',
      stageReason: 'verifying the setup',
      pipeline: [...SHAPE_PIPELINES.change],
      rounds: [
        createRound({ title: 'Hey', request: 'Hey', pipeline: ['answer'], outcome: null }),
        createRound({
          number: 2,
          title: 'Fix the button in kanna',
          request: 'Fix the button in kanna',
          status: 'active',
          pipeline: [...SHAPE_PIPELINES.change],
          outcome: null,
        }),
      ],
      activity: [
        {
          at: 1,
          actor: 'you',
          kind: 'message',
          text: 'Sent instructions',
          detail: 'Earlier',
          evidenceId: null,
        },
        {
          at: 2,
          actor: 'you',
          kind: 'message',
          text: 'Sent instructions',
          detail: 'It is the web one',
          evidenceId: null,
          round: 2,
        },
      ],
      proposal: {
        request: 'Make the button blue',
        why: 'It is grey.',
        status: 'accepted',
        runId: null,
        at: 1,
      },
    });
  }

  test('reads the round’s request, the change agreed to and the messages, and binds the repository it names', async () => {
    const calls: { system: string; prompt: string; schema: JsonSchema | undefined }[] = [];
    const ask: QuickJson = <T>(system: string, prompt: string, schema?: JsonSchema) => {
      calls.push({ system, prompt, schema });
      return Promise.resolve({ repo: 'kanna' } as T);
    };
    expect(await resolveRoundRepository(createState(), unbound(), LOCAL, ask)).toBe('/code/kanna');
    const [call] = calls;
    expect(call?.schema?.properties.repo).toEqual({ type: 'string', enum: ['kanna', 'shinsa', 'none'] });
    expect(call?.system).toContain('Never pick a repository only because it is the only one listed');
    expect(call?.prompt).toContain('- Round 2: Fix the button in kanna (change, in progress).');
    expect(call?.prompt).toContain('Repositories:\n- kanna: /code/kanna\n- shinsa: /code/shinsa');
    expect(call?.prompt).toContain('What this round asks for:\nFix the button in kanna');
    expect(call?.prompt).toContain('The change the human agreed to:\nMake the button blue');
    expect(call?.prompt).toContain('The human added since:\n- It is the web one');
    expect(call?.prompt).not.toContain('Earlier');
  });

  test('none, an unknown name or no answer binds nothing, and with nothing to offer the model is not asked', async () => {
    for (const value of [{ repo: 'none' }, { repo: 'elsewhere' }, null]) {
      expect(await resolveRoundRepository(createState(), unbound(), LOCAL, answer(value))).toBeNull();
    }
    const plain = createTask({ repoId: null, request: 'Fix it', activity: [], proposal: null });
    expect(await resolveRoundRepository(createState(), plain, [], notAsked)).toBeNull();
    const state = createState();
    state.repos.r1 = createRepo({ id: 'r1', name: 'kanna', path: '/code/kanna' });
    const prompts: string[] = [];
    const ask: QuickJson = <T>(_system: string, prompt: string) => {
      prompts.push(prompt);
      return Promise.resolve({ repo: 'kanna' } as T);
    };
    expect(await resolveRoundRepository(state, plain, [], ask)).toBe('/code/kanna');
    expect(prompts[0]).toContain('What this round asks for:\nFix it');
    expect(prompts[0]).not.toContain('agreed to');
    expect(prompts[0]).not.toContain('added since');
  });

  test('a repository outside the task’s project is offered once the round or a message names it', async () => {
    const state = createState();
    state.projects.p1 = {
      id: 'p1',
      name: 'Shinsa',
      color: 'blue',
      key: 'SW',
      description: '',
      folders: [],
    } as (typeof state.projects)[string];
    state.repos.r1 = createRepo({ id: 'r1', name: 'shinsa', path: '/code/shinsa', projectId: 'p1' });
    const calls: { prompt: string; schema: JsonSchema | undefined }[] = [];
    const ask: QuickJson = <T>(_system: string, prompt: string, schema?: JsonSchema) => {
      calls.push({ prompt, schema });
      return Promise.resolve({ repo: 'kanna' } as T);
    };
    const named = { ...unbound(), projectId: 'p1' };
    expect(await resolveRoundRepository(state, named, LOCAL, ask)).toBe('/code/kanna');
    expect(calls[0]?.schema?.properties.repo).toEqual({ type: 'string', enum: ['shinsa', 'kanna', 'none'] });
    expect(calls[0]?.prompt).toContain(
      'Repositories outside this project, offered because the request names them: kanna.'
    );
    const vague = createTask({
      repoId: null,
      projectId: 'p1',
      request: 'Make the answer a doc in the repo',
      activity: [],
      proposal: null,
    });
    expect(await resolveRoundRepository(state, vague, LOCAL, ask)).toBeNull();
    expect(calls[1]?.schema?.properties.repo).toEqual({ type: 'string', enum: ['shinsa', 'none'] });
    expect(calls[1]?.prompt).toContain(
      'Other repositories on the machine outside this project, never offered: kanna.'
    );
  });
});
