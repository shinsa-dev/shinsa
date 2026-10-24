import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTaskRounds, type UserCommand } from '@shinsa/core';
import type { JsonSchema } from '../../src/agents/providers/index.ts';
import type { QuickJson } from '../../src/agents/quick/index.ts';
import { Engine } from '../../src/runtime/engine.ts';
import { EventLog } from '../../src/store/index.ts';
import {
  createMessageClassifier,
  type MessageClass,
  type MessageClassifier,
  resolveMessageClass,
  routeUserCommand,
} from '../../src/triage/message.ts';
import { until } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

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
  await engine.dispatch({ type: 'task.create', intent: 'Add MCP v2', repoId: null });
  const taskId = Object.keys(engine.state.tasks)[0] ?? '';
  return { engine, taskId };
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
      intent: 'Add MCP v2\nwith tools',
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
      required: ['kind', 'shape', 'title', 'why'],
      properties: { kind: { type: 'string', enum: ['feedback', 'new_round', 'separate_task'] } },
    });
    expect(call?.system).toContain('A task is a conversation that runs in rounds');
    expect(call?.prompt).toContain(
      'Task: Add MCP v2\nIt started from: Add MCP v2\nIts rounds:\n- Round 1: Add MCP v2 (in progress)'
    );
    expect(call?.prompt).toContain('The current round, 1, is building.');
    expect(call?.prompt).toContain('Message:\nAlso add search');
  });

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
    const classify = createMessageClassifier(
      answer({ kind: 'separate_task', shape: 'change', title: 'Billing', why: 'Elsewhere.' })
    );
    expect(await classify(task, 'Redo billing')).toMatchObject({ kind: 'separate_task', title: 'Billing' });
  });
});

describe('routing a command through the classifier', () => {
  test('a message becomes a new round, and a repeat under the same id is answered without asking again', async () => {
    const { engine, taskId } = await openEngine();
    let asked = 0;
    const classify: MessageClassifier = () => {
      asked += 1;
      return Promise.resolve({ kind: 'new_round', title: 'Search', why: 'New work.', shape: 'change' });
    };
    const first = await routeUserCommand(engine, message(taskId), 'client:1', classify);
    expect(first.map((event) => event.type)).toEqual(['task.messaged', 'round.queued']);
    expect(resolveTaskRounds(engine.state.tasks[taskId] ?? createTask())[1]).toMatchObject({
      title: 'Search',
      why: 'New work.',
    });
    const again = await routeUserCommand(engine, message(taskId), 'client:1', classify);
    expect(again).toEqual(first);
    expect(asked).toBe(1);
  });

  test('feedback keeps no shape, and a message the classifier cannot read stays feedback', async () => {
    const { engine, taskId } = await openEngine();
    await routeUserCommand(engine, message(taskId, 'Use tabs'), null, () =>
      Promise.resolve({ kind: 'feedback', title: null, why: null, shape: 'fix' })
    );
    await routeUserCommand(engine, message(taskId, 'Hmm'), null, () => Promise.resolve(null));
    const entries = engine.state.tasks[taskId]?.activity.filter((entry) => entry.kind === 'message') ?? [];
    expect(entries.map((entry) => entry.detail)).toEqual(['Use tabs', 'Hmm']);
    expect(resolveTaskRounds(engine.state.tasks[taskId] ?? createTask())).toHaveLength(1);
  });

  test('a command that is not a message, one that says what it is, or one without a classifier goes straight in', async () => {
    const { engine, taskId } = await openEngine();
    const never: MessageClassifier = () => Promise.reject(new Error('not asked'));
    await routeUserCommand(engine, { type: 'task.prioritize', taskId, priority: 'high' }, null, never);
    await routeUserCommand(engine, { ...message(taskId), kind: 'new_round' }, null, never);
    await routeUserCommand(engine, message(taskId, 'Plain'), null, null);
    expect(engine.state.tasks[taskId]?.priority).toBe('high');
    expect(resolveTaskRounds(engine.state.tasks[taskId] ?? createTask())).toHaveLength(2);
  });

  test('a message to a finished or missing task is not classified', async () => {
    const { engine, taskId } = await openEngine();
    await engine.dispatch({ type: 'task.cancel', taskId });
    const never: MessageClassifier = () => Promise.reject(new Error('not asked'));
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
    await routeUserCommand(engine, message(taskId, 'Redo billing'), null, classify);
    const rounds = resolveTaskRounds(engine.state.tasks[taskId] ?? createTask());
    expect(rounds.at(-1)).toMatchObject({ title: 'Redo billing', status: 'queued' });
    expect(rounds.at(-1)?.pipeline[0]).toBe('investigate');
  });

  test('two sends of one message under the same id ask the classifier once and land once', async () => {
    const { engine, taskId } = await openEngine();
    const answers: ((value: MessageClass) => void)[] = [];
    const classify: MessageClassifier = () => {
      return new Promise((resolve) => {
        answers.push(resolve);
      });
    };
    const first = routeUserCommand(engine, message(taskId), 'client:7', classify);
    const second = routeUserCommand(engine, message(taskId), 'client:7', classify);
    await until('the classifier to be asked', () => answers.length > 0);
    for (const resolve of answers)
      resolve({ kind: 'new_round', title: 'Search', why: 'New work.', shape: 'change' });
    const [landed, repeated] = await Promise.all([first, second]);
    expect(repeated).toEqual(landed);
    expect(answers).toHaveLength(1);
    expect(resolveTaskRounds(engine.state.tasks[taskId] ?? createTask())).toHaveLength(2);
  });
});
