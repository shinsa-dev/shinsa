import { describe, expect, test } from 'bun:test';
import {
  readStructuredOutput,
  requestClaudeCompletion,
  requestClaudeStructured,
} from '../../../../src/agents/providers/claude/complete.ts';
import { createFakeQuery, createFakeRuntime, emit, sdkMessage } from '../../../helpers/query.ts';

const REQUEST = { system: 'system', prompt: 'prompt', model: 'haiku' };

const SCHEMA = { type: 'object' as const, properties: { size: { type: 'string' } }, required: ['size'] };

function hangUntilAborted() {
  return createFakeQuery((params) => ({
    async *[Symbol.asyncIterator]() {
      await new Promise((resolve) =>
        params.options?.abortController?.signal.addEventListener('abort', resolve)
      );
      throw new Error('aborted');
    },
  }));
}

describe('requestClaudeCompletion', () => {
  test('asks once, without tools or thinking, on the user’s claude, and returns the answer', async () => {
    const fake = createFakeQuery(() =>
      emit({ type: 'assistant' }, { type: 'result', subtype: 'success', result: '  hi  ' })
    );
    expect(await requestClaudeCompletion(REQUEST, createFakeRuntime(fake.query))).toBe('hi');
    expect(fake.calls[0]?.options).toMatchObject({
      model: 'haiku',
      maxTurns: 1,
      tools: [],
      systemPrompt: 'system',
      thinking: { type: 'disabled' },
      pathToClaudeCodeExecutable: '/bin/claude',
      settings: { fastMode: false },
    });
    const fast = createFakeQuery(() => emit({ type: 'result', subtype: 'success', result: 'hi' }));
    await requestClaudeCompletion({ ...REQUEST, fastMode: true }, createFakeRuntime(fast.query));
    expect(fast.calls[0]?.options?.settings).toEqual({ fastMode: true });
  });

  test('returns nothing when the model gives no answer, and aborts when it takes too long', async () => {
    const silent = createFakeQuery(() => emit({ type: 'result', subtype: 'error_max_turns', errors: [] }));
    expect(await requestClaudeCompletion(REQUEST, createFakeRuntime(silent.query))).toBeNull();
    expect(requestClaudeCompletion(REQUEST, createFakeRuntime(hangUntilAborted().query), 10)).rejects.toThrow(
      'aborted'
    );
  });
});

describe('requestClaudeStructured', () => {
  test('asks for JSON matching the schema and reads the structured output from the result', async () => {
    let closed = 0;
    const fake = createFakeQuery(
      () =>
        emit(
          { type: 'assistant', message: { content: [] } },
          { type: 'result', subtype: 'success', structured_output: { size: 'large' } }
        ),
      {
        close: () => {
          closed += 1;
        },
      }
    );
    expect(
      await requestClaudeStructured({ ...REQUEST, schema: SCHEMA }, createFakeRuntime(fake.query))
    ).toEqual({
      size: 'large',
    });
    expect(fake.calls[0]?.options).toMatchObject({
      model: 'haiku',
      tools: [],
      outputFormat: { type: 'json_schema', schema: SCHEMA },
      effort: 'low',
      settings: { fastMode: false },
    });
    expect(closed).toBe(1);
    const fast = createFakeQuery(() => emit({ type: 'result', subtype: 'success', structured_output: {} }));
    await requestClaudeStructured(
      { ...REQUEST, schema: SCHEMA, fastMode: true },
      createFakeRuntime(fast.query)
    );
    expect(fast.calls[0]?.options?.settings).toEqual({ fastMode: true });
  });

  test('reads the StructuredOutput tool call too, and returns nothing when there is no output', async () => {
    const tool = createFakeQuery(() =>
      emit({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'x' },
            { type: 'tool_use', name: 'StructuredOutput', input: { size: 'small' } },
          ],
        },
      })
    );
    expect(
      await requestClaudeStructured({ ...REQUEST, schema: SCHEMA }, createFakeRuntime(tool.query))
    ).toEqual({
      size: 'small',
    });
    const none = createFakeQuery(() => emit({ type: 'result', subtype: 'error_max_turns', errors: [] }));
    expect(
      await requestClaudeStructured({ ...REQUEST, schema: SCHEMA }, createFakeRuntime(none.query))
    ).toBeNull();
  });

  test('gives up after the timeout with a reason, and passes other errors on', async () => {
    const slow = hangUntilAborted();
    expect(
      requestClaudeStructured({ ...REQUEST, schema: SCHEMA, timeoutMs: 10 }, createFakeRuntime(slow.query))
    ).rejects.toThrow('Claude did not answer within 10 ms.');
    const broken = createFakeQuery(() => ({
      async *[Symbol.asyncIterator]() {
        yield sdkMessage({ type: 'system', subtype: 'init' });
        throw new Error('spawn failed');
      },
    }));
    expect(
      requestClaudeStructured({ ...REQUEST, schema: SCHEMA }, createFakeRuntime(broken.query))
    ).rejects.toThrow('spawn failed');
  });

  test('readStructuredOutput ignores everything but results and the StructuredOutput call', () => {
    expect(readStructuredOutput(sdkMessage({ type: 'system', subtype: 'init' }))).toBeNull();
    expect(readStructuredOutput(sdkMessage({ type: 'result', subtype: 'success' }))).toBeNull();
    expect(
      readStructuredOutput(
        sdkMessage({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'StructuredOutput' }] },
        })
      )
    ).toBeNull();
  });
});
