import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

async function open(options?: Parameters<typeof World.create>[0]) {
  world = await World.create(options);
  return world;
}

async function createTask(w: World, intent: string) {
  const before = new Set(Object.keys(w.state.tasks));
  await w.engine.dispatch({ type: 'task.create', intent, repoId: w.repoId });
  return Object.keys(w.state.tasks).find((id) => !before.has(id)) ?? '';
}

describe('the process around the work', () => {
  test('a repository with nothing to check stops at the setup gate until you skip the checks', async () => {
    const w = await open({ checks: [] });
    const taskId = await createTask(w, 'Add the greeting files');
    const gate = await w.untilGate(taskId, 'question', 'configuration');
    expect(gate.title).toBe('No checks to run');
    expect(w.agents.sessions).toHaveLength(0);
    expect(existsSync(`${w.config.worktreesDir}/${taskId}`)).toBe(false);
    await w.answer(gate, 'answer');
    await w.untilStage(taskId, 'awaiting_review');
    expect(w.state.repos[w.repoId]?.checksWaived).toBe(true);
  });

  test('a builder can wait for something outside the repository, and suggest follow-ups', async () => {
    const w = await open();
    w.agents.queue('builder', async (agent) => {
      await agent.call('suggest_tasks', {
        tasks: [{ title: 'Cache the greetings', request: 'Cache them.', why: 'They are read often.' }],
      });
      await agent.call('wait_for', { check_in_minutes: 30, notes: 'The staging deploy.' });
    });
    const taskId = await createTask(w, 'Add the greeting files');
    await w.until('the wait', () => w.task(taskId).monitor?.status === 'armed');
    expect(w.task(taskId).monitor).toMatchObject({ notes: 'The staging deploy.', attempts: 0 });
    expect(w.task(taskId).suggestions?.map((suggestion) => suggestion.title)).toEqual([
      'Cache the greetings',
    ]);
    expect(w.activeRuns(taskId)).toHaveLength(0);
  });
});
