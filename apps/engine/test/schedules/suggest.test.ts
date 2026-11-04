import { describe, expect, test } from 'bun:test';
import { SCHEDULE_LIMITS } from '@shinsa/core';
import { Effect } from 'effect';
import { createWatchWriter, describeWatchPrompt } from '../../src/schedules/suggest.ts';

function createAsk(answer: unknown) {
  const calls: { system: string; prompt: string; schema: unknown }[] = [];
  const ask = <T>(system: string, prompt: string, schema?: unknown) => {
    calls.push({ system, prompt, schema });
    return Effect.succeed(answer as T | null);
  };
  return { ask, calls };
}

describe('wording a suggested watch', () => {
  test('asks the writer with the integration and what it holds, and keeps its one-line name and text', async () => {
    const { ask, calls } = createAsk({
      name: ' Bugs in #feedback ',
      text: 'File a task for each new bug in #feedback.\nAnd more.',
    });
    expect(await Effect.runPromise(createWatchWriter(ask)('slack', 'Bug reports in #feedback'))).toEqual({
      name: 'Bugs in #feedback',
      text: 'File a task for each new bug in #feedback.',
    });
    expect(calls[0]?.prompt).toBe(describeWatchPrompt('slack', 'Bug reports in #feedback'));
    expect(calls[0]?.prompt).toBe('Integration: slack\nWhat it holds: Bug reports in #feedback');
    expect(calls[0]?.system).toContain('File a task for each new');
    expect(calls[0]?.schema).toMatchObject({ required: ['name', 'text'] });
  });

  test('leaves out what the writer did not give, gave empty or made too long, for core to word plainly', async () => {
    expect(await Effect.runPromise(createWatchWriter(createAsk(null).ask)('maple', 'Errors'))).toEqual({
      name: null,
      text: null,
    });
    const long = 'x'.repeat(SCHEDULE_LIMITS.name + 1);
    expect(
      await Effect.runPromise(
        createWatchWriter(createAsk({ name: long, text: '   ' }).ask)('maple', 'Errors')
      )
    ).toEqual({
      name: null,
      text: null,
    });
    expect(
      await Effect.runPromise(
        createWatchWriter(createAsk({ name: 3, text: 'x'.repeat(201) }).ask)('maple', 'Errors')
      )
    ).toEqual({
      name: null,
      text: null,
    });
  });

  test('a writer that fails passes its failure on', async () => {
    const ask = () => Effect.die(new Error('the writer is down'));
    await expect(Effect.runPromise(createWatchWriter(ask)('slack', 'Bug reports'))).rejects.toThrow(
      'the writer is down'
    );
  });
});
