import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { createAutopilotJudge, createAutopilotWeigher } from '../../src/autopilot/judge.ts';

function createAsk(answer: unknown) {
  const calls: { system: string; prompt: string; schema: unknown }[] = [];
  const ask = <T>(system: string, prompt: string, schema?: unknown) => {
    calls.push({ system, prompt, schema });
    return Effect.succeed(answer as T | null);
  };
  return { ask, calls };
}

describe('the Autopilot judge', () => {
  test('asks with the prompt and schema and keeps the verdict, the reason and the reply', async () => {
    const { ask, calls } = createAsk({ verdict: 'act', reason: 'Clear and small.', reply: 'The inner one.' });
    expect(await Effect.runPromise(createAutopilotJudge(ask)('system', 'prompt'))).toEqual({
      verdict: 'act',
      reason: 'Clear and small.',
      reply: 'The inner one.',
    });
    expect(calls).toEqual([
      {
        system: 'system',
        prompt: 'prompt',
        schema: expect.objectContaining({ required: ['verdict', 'reason', 'reply'] }),
      },
    ]);
  });

  test('reads a missing reply as none', async () => {
    const { ask } = createAsk({ verdict: 'forward', reason: 'Unclear.' });
    expect(await Effect.runPromise(createAutopilotJudge(ask)('s', 'p'))).toEqual({
      verdict: 'forward',
      reason: 'Unclear.',
      reply: null,
    });
  });

  test('gives nothing for no answer or one it cannot read', async () => {
    expect(await Effect.runPromise(createAutopilotJudge(createAsk(null).ask)('s', 'p'))).toBeNull();
    const odd = createAsk({ verdict: 'maybe', reason: 'x' });
    expect(await Effect.runPromise(createAutopilotJudge(odd.ask)('s', 'p'))).toBeNull();
  });
});

describe('weighing a suggested task', () => {
  test('asks with its own schema and keeps the verdict and the reason', async () => {
    const { ask, calls } = createAsk({ verdict: 'dismiss', reason: 'Repeats open work.' });
    expect(await Effect.runPromise(createAutopilotWeigher(ask)('system', 'prompt'))).toEqual({
      verdict: 'dismiss',
      reason: 'Repeats open work.',
    });
    expect(calls[0]?.schema).toEqual(expect.objectContaining({ required: ['verdict', 'reason'] }));
  });

  test('gives nothing for no answer or one it cannot read', async () => {
    expect(await Effect.runPromise(createAutopilotWeigher(createAsk(null).ask)('s', 'p'))).toBeNull();
    const odd = createAsk({ verdict: 'act', reason: 'x' });
    expect(await Effect.runPromise(createAutopilotWeigher(odd.ask)('s', 'p'))).toBeNull();
  });
});
