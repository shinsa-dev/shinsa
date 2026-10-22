import { afterEach, describe, expect, test } from 'bun:test';
import type { ModelCatalog } from '../src/agents/index.ts';
import { type Shinsa, startShinsa } from '../src/serve.ts';
import { createTempDir, createTestConfig } from './helpers/index.ts';

const started: Shinsa[] = [];

afterEach(async () => {
  for (const shinsa of started.splice(0)) await shinsa.stop();
});

const models = { list: () => Promise.resolve([]) } as unknown as ModelCatalog;

describe('startShinsa', () => {
  test('inspect mode serves the data without starting agents', async () => {
    const shinsa = await startShinsa(createTestConfig(createTempDir(), { inspect: true }), { models });
    started.push(shinsa);
    await shinsa.engine.dispatch({ type: 'task.create', intent: 'Look only', repoId: null });
    await Bun.sleep(20);
    expect(Object.values(shinsa.engine.state.tasks)[0]?.stage).toBe('triage');
    expect(await (await fetch(`${shinsa.url}/api/queue`)).json()).toMatchObject({ decisions: [] });
  });

  test('a full start recovers, runs effects and stops cleanly', async () => {
    const config = createTestConfig(createTempDir(), { roots: [createTempDir()] });
    const shinsa = await startShinsa(config, {
      models,
      triage: () => Promise.resolve(null),
      resolveLogin: () => Promise.resolve(null),
      startSession: () => {
        throw new Error('no agents here');
      },
    });
    started.push(shinsa);
    await shinsa.engine.dispatch({ type: 'task.create', intent: 'Do it', repoId: null });
    for (let wait = 0; wait < 100 && Object.keys(shinsa.engine.state.gates).length === 0; wait += 1)
      await Bun.sleep(50);
    expect(Object.values(shinsa.engine.state.gates)[0]?.title).toBe('Could not start the task');
  });

  test('the default model catalog is used when none is given', async () => {
    const shinsa = await startShinsa(createTestConfig(createTempDir(), { inspect: true }));
    started.push(shinsa);
    expect(shinsa.url.startsWith('http://127.0.0.1:')).toBe(true);
  });
});
