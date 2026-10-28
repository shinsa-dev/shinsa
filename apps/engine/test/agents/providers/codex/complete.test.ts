import { describe, expect, test } from 'bun:test';
import {
  requestCodexCompletion,
  requestCodexStructured,
} from '../../../../src/agents/providers/codex/complete.ts';
import { FakeCodex } from '../../../helpers/codex.ts';

const REQUEST = { system: 'You classify.', prompt: 'Is this small?', model: 'gpt-5.6-luna' };

const SCHEMA = { type: 'object' as const, properties: { size: { type: 'string' } }, required: ['size'] };

describe('one-shot calls on Codex', () => {
  test('a text call runs one read-only, ephemeral turn with the system as instructions', async () => {
    const codex = new FakeCodex({ quick: '  It is small.  ' });
    expect(await requestCodexCompletion(REQUEST, codex.runtime)).toBe('It is small.');
    expect(codex.requests('thread/start')[0]).toMatchObject({
      model: 'gpt-5.6-luna',
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      developerInstructions: 'You classify.',
      serviceTier: null,
    });
    expect(codex.requests('turn/start')[0]).toMatchObject({ effort: 'low', prompt: 'Is this small?' });
  });

  test('a call in fast mode asks for the fast tier', async () => {
    const fast = new FakeCodex({ quick: 'small' });
    await requestCodexCompletion({ ...REQUEST, fastMode: true }, fast.runtime);
    expect(fast.requests('thread/start')[0]?.serviceTier).toBe('fast');
  });

  test('a structured call sends the schema and parses the answer', async () => {
    const codex = new FakeCodex({ quick: '{"size": "small"}' });
    expect(await requestCodexStructured({ ...REQUEST, schema: SCHEMA }, codex.runtime)).toEqual({
      size: 'small',
    });
    expect(codex.requests('turn/start')[0]?.outputSchema).toEqual(SCHEMA);
  });

  test.each([
    ['prose', 'small'],
    ['nothing', '   '],
  ])('a structured call answered with %s is null', async (_name, quick) => {
    const codex = new FakeCodex({ quick });
    expect(await requestCodexStructured({ ...REQUEST, schema: SCHEMA }, codex.runtime)).toBeNull();
  });

  test.each<[string, ConstructorParameters<typeof FakeCodex>[0], string]>([
    ['a failed turn', { quickFails: true }, 'The quick model is down.'],
    ['a refused start', { refuse: ['thread/start'] }, 'fake codex refuses thread/start'],
    ['a crash', { quick: '__crash__' }, 'the quick model crashed'],
  ])('%s throws what Codex said', async (_name, state, message) => {
    await expect(requestCodexCompletion(REQUEST, new FakeCodex(state).runtime)).rejects.toThrow(message);
  });

  test('a missing codex throws without starting anything', async () => {
    const missing = {
      resolveExecutable: () =>
        Promise.resolve({
          ok: false as const,
          reason: 'not_installed' as const,
          message: 'No codex.',
          version: null,
        }),
    };
    await expect(requestCodexCompletion(REQUEST, missing)).rejects.toThrow('No codex.');
  });

  test('a question from Codex is refused, and the refusal comes back as the answer', async () => {
    expect(await requestCodexCompletion(REQUEST, new FakeCodex({ quick: '__ask__' }).runtime)).toContain(
      'A quick call does not answer item/tool/requestUserInput.'
    );
  });

  test('a call Codex never answers throws once its time is up', async () => {
    const slow = new FakeCodex({ refuse: [] });
    slow.script('*', [{ hang: true }]);
    await expect(
      requestCodexStructured({ ...REQUEST, schema: SCHEMA, timeoutMs: 1 }, slow.runtime)
    ).rejects.toThrow();
  });
});
