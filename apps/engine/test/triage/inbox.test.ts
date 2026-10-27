import { describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { resolveTaskRounds } from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { Engine } from '../../src/runtime/engine.ts';
import { EventLog } from '../../src/store/index.ts';
import { MessageInbox } from '../../src/triage/inbox.ts';
import type { MessageClass, MessageClassifier } from '../../src/triage/message.ts';
import { createTempDir, until } from '../helpers/index.ts';

const NEW_ROUND: MessageClass = { kind: 'new_round', title: 'Search', why: 'New work.', shape: 'change' };

async function openEngine(path = join(createTempDir('shinsa-inbox-'), 'shinsa.sqlite')) {
  const engine = new Engine(new EventLog(path));
  if (Object.keys(engine.state.tasks).length === 0) {
    await engine.dispatch({ type: 'task.create', request: 'Add MCP v2', repoId: null });
  }
  const taskId = Object.keys(engine.state.tasks)[0] ?? '';
  return { engine, taskId, path };
}

function receive(engine: Engine, taskId: string, text: string) {
  return engine.dispatch({ type: 'message.receive', taskId, text });
}

function deferredClassifier() {
  const asked: { text: string; answer: (value: MessageClass | null) => void }[] = [];
  const classify: MessageClassifier = (_task, text) => {
    return new Promise((resolve) => {
      asked.push({ text, answer: resolve });
    });
  };
  return { asked, classify };
}

function readMessages(engine: Engine, taskId: string) {
  return engine.state.tasks[taskId]?.activity.flatMap((entry) =>
    entry.kind === 'message' ? [entry.detail] : []
  );
}

describe('the message inbox', () => {
  test('routes messages in the order they were sent, and the ones sent meanwhile together after them', async () => {
    const { engine, taskId } = await openEngine();
    const { asked, classify } = deferredClassifier();
    const inbox = new MessageInbox(engine, classify);
    inbox.start();
    await receive(engine, taskId, 'First');
    await until('the first message to be classified', () => asked.length === 1);
    await receive(engine, taskId, 'Second');
    await receive(engine, taskId, 'Third');
    asked[0]?.answer(null);
    await until('the next messages to be classified', () => asked.length === 2);
    expect(asked.map((question) => question.text)).toEqual(['First', 'Second\n\nThird']);
    asked[1]?.answer(null);
    await inbox.settle();
    inbox.stop();
    expect(readMessages(engine, taskId)).toEqual(['First', 'Second', 'Third']);
    expect(engine.state.tasks[taskId]?.inbox).toEqual([]);
  });

  test('a classifier that never answers holds the messages only until its time is up', async () => {
    const { engine, taskId } = await openEngine();
    const warn = spyOn(log, 'warn');
    const inbox = new MessageInbox(engine, () => new Promise(() => undefined), { classifyTimeoutMs: 20 });
    inbox.start();
    await receive(engine, taskId, 'test');
    await receive(engine, taskId, 'hey!');
    await until('the inbox to empty', () => engine.state.tasks[taskId]?.inbox?.length === 0);
    await inbox.settle();
    inbox.stop();
    expect(readMessages(engine, taskId)).toEqual(['test', 'hey!']);
    expect(warn.mock.calls.some(([, fields]) => String(fields?.error).includes('within 20 ms'))).toBe(true);
    warn.mockRestore();
  });

  test('a route that breaks for a reason the task did not give is dropped, so the message is never left waiting', async () => {
    const { engine, taskId } = await openEngine();
    const error = spyOn(log, 'error');
    const inbox = new MessageInbox(engine, () =>
      Promise.resolve({ ...NEW_ROUND, shape: 'unknown' as MessageClass['shape'] })
    );
    inbox.start();
    await receive(engine, taskId, 'Also add search');
    await until('the inbox to empty', () => engine.state.tasks[taskId]?.inbox?.length === 0);
    await inbox.settle();
    inbox.stop();
    expect(engine.state.tasks[taskId]?.activity.at(-1)).toMatchObject({
      kind: 'failure',
      undelivered: { text: 'Also add search', reason: 'Shinsa could not deliver it. Send it again.' },
      detail: 'Shinsa could not deliver it. Send it again.\n\nYour message: Also add search',
    });
    expect(error.mock.calls.some(([message]) => String(message).includes('dropping it'))).toBe(true);
    error.mockRestore();
  });

  test('a classifier that throws leaves the message feedback', async () => {
    const { engine, taskId } = await openEngine();
    const warn = spyOn(log, 'warn');
    const inbox = new MessageInbox(engine, () => Promise.reject(new Error('model down')));
    inbox.start();
    await receive(engine, taskId, 'Use tabs');
    await inbox.settle();
    inbox.stop();
    expect(readMessages(engine, taskId)).toEqual(['Use tabs']);
    expect(
      warn.mock.calls.some(([message]) => String(message).startsWith('[Inbox] Could not classify'))
    ).toBe(true);
    warn.mockRestore();
  });

  test('a message the task can no longer take is dropped with the reason', async () => {
    const { engine, taskId } = await openEngine();
    const { asked, classify } = deferredClassifier();
    const inbox = new MessageInbox(engine, classify);
    inbox.start();
    await receive(engine, taskId, 'Also add search');
    await until('the classifier to be asked', () => asked.length === 1);
    await engine.dispatch({ type: 'task.cancel', taskId });
    asked[0]?.answer(NEW_ROUND);
    await inbox.settle();
    inbox.stop();
    expect(engine.state.tasks[taskId]?.inbox).toEqual([]);
    expect(engine.state.tasks[taskId]?.activity.at(-1)).toMatchObject({
      kind: 'failure',
      text: 'Could not deliver your message',
    });
  });

  test('a message left by a stop is routed on the next start', async () => {
    const first = await openEngine();
    const { asked, classify } = deferredClassifier();
    const stopped = new MessageInbox(first.engine, classify);
    stopped.start();
    await receive(first.engine, first.taskId, 'Also add search');
    await until('the classifier to be asked', () => asked.length === 1);
    stopped.stop();
    asked[0]?.answer(NEW_ROUND);
    await stopped.settle();
    expect(first.engine.state.tasks[first.taskId]?.inbox).toHaveLength(1);
    first.engine.stop();
    await first.engine.settle();

    const { engine, taskId } = await openEngine(first.path);
    const inbox = new MessageInbox(engine, () => Promise.resolve(NEW_ROUND));
    inbox.start();
    await inbox.settle();
    inbox.stop();
    expect(engine.state.tasks[taskId]?.inbox).toEqual([]);
    const task = engine.state.tasks[taskId];
    expect(task ? resolveTaskRounds(task) : []).toHaveLength(2);
  });

  test('a route that fails for another reason stays in the inbox and is logged', async () => {
    const { engine, taskId } = await openEngine();
    const { asked, classify } = deferredClassifier();
    const error = spyOn(log, 'error');
    const inbox = new MessageInbox(engine, classify);
    inbox.start();
    await receive(engine, taskId, 'Also add search');
    await until('the classifier to be asked', () => asked.length === 1);
    engine.stop();
    asked[0]?.answer(NEW_ROUND);
    await inbox.settle();
    inbox.sync();
    await inbox.settle();
    inbox.stop();
    expect(asked).toHaveLength(1);
    expect(engine.state.tasks[taskId]?.inbox).toHaveLength(1);
    expect(error.mock.calls.some(([message]) => String(message).startsWith('[Inbox] Could not route'))).toBe(
      true
    );
    error.mockRestore();
    await engine.settle();
  });
});
