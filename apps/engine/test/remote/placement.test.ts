import { describe, expect, test } from 'bun:test';
import { PLACEMENT_SCHEMA, PLACEMENT_SYSTEM, type PlacementQuestion } from '@shinsa/core';
import { Effect, Layer } from 'effect';
import type { QuickJson } from '../../src/agents/quick/schema.ts';
import { QuickCalls } from '../../src/agents/quick/service.ts';
import { PlacementAsker } from '../../src/remote/placement/service.ts';

function createPlacementAsker(classify: QuickJson) {
  const asker = Effect.runSync(
    PlacementAsker.pipe(
      Effect.provide(
        PlacementAsker.layer.pipe(Layer.provide(Layer.succeed(QuickCalls, { classify, write: classify })))
      )
    )
  );
  return (question: PlacementQuestion) => Effect.runPromise(asker.place(question));
}

const QUESTION: PlacementQuestion = {
  request: 'Run the Xcode simulator tests',
  machines: [
    {
      id: 'studio',
      name: 'Studio',
      policies: ['Run Xcode simulator tests on this machine.'],
      projects: [{ name: 'App', description: 'The iOS app.', repositories: ['app-ios'] }],
      repositories: [],
      open: 1,
      capacity: null,
      resources: null,
    },
    {
      id: 'box',
      name: 'Build box',
      policies: [],
      projects: [],
      repositories: ['scratch'],
      open: 0,
      capacity: 4,
      resources: null,
    },
  ],
};

describe('choosing a machine by its policies, projects and room', () => {
  test('asks the classifier with the fixed system prompt, and keeps only an answer naming a machine', async () => {
    const asked: [string, string, unknown][] = [];
    const place = createPlacementAsker(<T>(system: string, prompt: string, schema?: unknown) => {
      asked.push([system, prompt, schema]);
      return Effect.succeed({ machine: 'studio', reason: 'Xcode simulator tests run on Studio.' } as T);
    });
    expect(await place(QUESTION)).toEqual({
      machineId: 'studio',
      reason: 'Xcode simulator tests run on Studio.',
    });
    expect(asked[0]?.[0]).toBe(PLACEMENT_SYSTEM);
    expect(asked[0]?.[1]).toContain('Run Xcode simulator tests on this machine.');
    expect(asked[0]?.[2]).toBe(PLACEMENT_SCHEMA);
    const none = createPlacementAsker(<T>() =>
      Effect.succeed({ machine: 'none', reason: 'No policy fits.' } as T)
    );
    expect(await none(QUESTION)).toBeNull();
  });

  test('refuses when Claude does not answer or names no machine, so the page says the policies were not read', async () => {
    const silent = createPlacementAsker(<T>() => Effect.succeed(null as T));
    await expect(silent(QUESTION)).rejects.toThrow('Claude did not answer. Try again.');
    const stray = createPlacementAsker(<T>() => Effect.succeed({ machine: 'laptop', reason: 'x' } as T));
    await expect(stray(QUESTION)).rejects.toThrow('Claude named none of your machines.');
  });

  test('a classifier that fails passes its failure on', async () => {
    const broken = createPlacementAsker(
      <T>() => Effect.die(new Error('classifier down')) as Effect.Effect<T | null>
    );
    await expect(broken(QUESTION)).rejects.toThrow('classifier down');
  });
});
