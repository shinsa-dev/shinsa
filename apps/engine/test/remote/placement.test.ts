import { describe, expect, test } from 'bun:test';
import { PLACEMENT_SCHEMA, PLACEMENT_SYSTEM, type PlacementQuestion } from '@shinsa/core';
import { createPlacementAsker, createPlacementRoutes } from '../../src/remote/placement.ts';

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
      return Promise.resolve({ machine: 'studio', reason: 'Xcode simulator tests run on Studio.' } as T);
    });
    expect(await place(QUESTION)).toEqual({
      machineId: 'studio',
      reason: 'Xcode simulator tests run on Studio.',
    });
    expect(asked[0]?.[0]).toBe(PLACEMENT_SYSTEM);
    expect(asked[0]?.[1]).toContain('Run Xcode simulator tests on this machine.');
    expect(asked[0]?.[2]).toBe(PLACEMENT_SCHEMA);
    const none = createPlacementAsker(<T>() =>
      Promise.resolve({ machine: 'none', reason: 'No policy fits.' } as T)
    );
    expect(await none(QUESTION)).toBeNull();
  });

  test('refuses when Claude does not answer or names no machine, so the page says the policies were not read', async () => {
    const silent = createPlacementAsker(<T>() => Promise.resolve(null as T));
    await expect(silent(QUESTION)).rejects.toThrow('Claude did not answer. Try again.');
    const stray = createPlacementAsker(<T>() => Promise.resolve({ machine: 'laptop', reason: 'x' } as T));
    await expect(stray(QUESTION)).rejects.toThrow('Claude named none of your machines.');
  });

  test('POST /api/placement answers with the machine, and refuses a question it cannot read', async () => {
    const [route] = createPlacementRoutes(() => Promise.resolve({ machineId: 'box', reason: 'Room.' }));
    if (!route) throw new Error('no route');
    const post = (body: unknown) =>
      route.respond(
        /x/.exec('x') as RegExpExecArray,
        new Request('http://127.0.0.1/api/placement', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      );
    expect(route.pattern.test('/api/placement')).toBe(true);
    expect(await (await post(QUESTION)).json()).toEqual({ answer: { machineId: 'box', reason: 'Room.' } });
    await expect(post({ request: 'x', machines: [] })).rejects.toThrow(
      'Send the request and two or more machines'
    );
  });
});
