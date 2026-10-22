import { describe, expect, test } from 'bun:test';
import { parseJsonObject, requestQuickJson, requestQuickText } from '../../../src/agents/quick/index.ts';
import { overrideEnv } from '../../helpers/index.ts';
import { createFakeQuery, emit } from '../../helpers/query.ts';

function withQuickOn<T>(run: () => Promise<T>) {
  const restore = overrideEnv({ SHINSA_QUICK: undefined });
  return run().finally(restore);
}

describe('requestQuickText', () => {
  test('is off when SHINSA_QUICK is off', async () => {
    const fake = createFakeQuery(() => emit());
    expect(await requestQuickText('system', 'prompt', fake.query)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  test('asks Haiku once, without tools or thinking, and returns the answer', async () => {
    const fake = createFakeQuery(() =>
      emit({ type: 'assistant' }, { type: 'result', subtype: 'success', result: '  hi  ' })
    );
    expect(await withQuickOn(() => requestQuickText('system', 'prompt', fake.query))).toBe('hi');
    expect(fake.calls[0]?.options).toMatchObject({
      model: 'haiku',
      maxTurns: 1,
      tools: [],
      systemPrompt: 'system',
    });
  });

  test('returns nothing when the model gives no answer, and aborts when it takes too long', async () => {
    const silent = createFakeQuery(() => emit({ type: 'result', subtype: 'error_max_turns', errors: [] }));
    expect(await withQuickOn(() => requestQuickText('s', 'p', silent.query))).toBeNull();
    const slow = createFakeQuery((params) => ({
      async *[Symbol.asyncIterator]() {
        await new Promise((resolve) =>
          params.options?.abortController?.signal.addEventListener('abort', resolve)
        );
        throw new Error('aborted');
      },
    }));
    expect(withQuickOn(() => requestQuickText('s', 'p', slow.query, 10))).rejects.toThrow('aborted');
  });
});

describe('requestQuickJson', () => {
  test('reads the first JSON object in the answer, and falls back on anything else', async () => {
    const answer = (text: string) =>
      createFakeQuery(() => emit({ type: 'result', subtype: 'success', result: text })).query;
    expect(await withQuickOn(() => requestQuickJson('s', 'p', answer('Sure: {"a": 1} done')))).toEqual({
      a: 1,
    });
    expect(await withQuickOn(() => requestQuickJson('s', 'p', answer('no json')))).toBeNull();
    const broken = createFakeQuery(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('down')) }),
    }));
    expect(await withQuickOn(() => requestQuickJson('s', 'p', broken.query))).toBeNull();
  });

  test('parseJsonObject tolerates prose and broken JSON', () => {
    expect(parseJsonObject(null)).toBeNull();
    expect(parseJsonObject('{"x": }')).toBeNull();
    expect(parseJsonObject('{"x": 2}')).toEqual({ x: 2 });
  });
});
