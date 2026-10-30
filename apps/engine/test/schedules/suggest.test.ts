import { describe, expect, test } from 'bun:test';
import { SCHEDULE_LIMITS } from '@shinsa/core';
import { createWatchWriter, describeWatchPrompt } from '../../src/schedules/suggest.ts';

function createAsk(answer: unknown) {
  const calls: { system: string; prompt: string; schema: unknown }[] = [];
  const ask = <T>(system: string, prompt: string, schema?: unknown) => {
    calls.push({ system, prompt, schema });
    return Promise.resolve(answer as T | null);
  };
  return { ask, calls };
}

describe('wording a suggested watch', () => {
  test('asks the writer with the integration and what it holds, and keeps its one-line name and text', async () => {
    const { ask, calls } = createAsk({
      name: ' Bugs in #feedback ',
      text: 'File a task for each new bug in #feedback.\nAnd more.',
    });
    expect(await createWatchWriter(ask)('slack', 'Bug reports in #feedback')).toEqual({
      name: 'Bugs in #feedback',
      text: 'File a task for each new bug in #feedback.',
    });
    expect(calls[0]?.prompt).toBe(describeWatchPrompt('slack', 'Bug reports in #feedback'));
    expect(calls[0]?.prompt).toBe('Integration: slack\nWhat it holds: Bug reports in #feedback');
    expect(calls[0]?.system).toContain('File a task for each new');
    expect(calls[0]?.schema).toMatchObject({ required: ['name', 'text'] });
  });

  test('leaves out what the writer did not give, gave empty or made too long, for core to word plainly', async () => {
    expect(await createWatchWriter(createAsk(null).ask)('maple', 'Errors')).toEqual({
      name: null,
      text: null,
    });
    const long = 'x'.repeat(SCHEDULE_LIMITS.name + 1);
    expect(await createWatchWriter(createAsk({ name: long, text: '   ' }).ask)('maple', 'Errors')).toEqual({
      name: null,
      text: null,
    });
    expect(
      await createWatchWriter(createAsk({ name: 3, text: 'x'.repeat(201) }).ask)('maple', 'Errors')
    ).toEqual({
      name: null,
      text: null,
    });
  });
});
