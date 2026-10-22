import { describe, expect, test } from 'bun:test';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvent, RunRole } from '@shinsa/core';
import { AsyncQueue } from '../../../src/agents/claude/async-queue.ts';
import { type ClaudeSessionInput, startClaudeSession } from '../../../src/agents/claude/index.ts';
import { createShinsaToolServer } from '../../../src/agents/tools/index.ts';
import { createFakeQuery, type FakeQueryControls, sdkMessage } from '../../helpers/query.ts';

function createInput(overrides: Partial<ClaudeSessionInput> = {}) {
  const entries: ChatEvent[] = [];
  const sessions: string[] = [];
  const handleTool = () => Promise.resolve('ok');
  const input: ClaudeSessionInput = {
    role: 'builder',
    cwd: '/work',
    prompt: 'Build it',
    model: null,
    resume: null,
    defaultBranch: 'main',
    tools: createShinsaToolServer('builder', handleTool),
    handleTool,
    pluginDir: '/plugin',
    onSession: (id) => sessions.push(id),
    onEntry: (entry) => entries.push(entry),
    ...overrides,
  };
  return { input, entries, sessions };
}

function startScripted(input: ClaudeSessionInput, controls: FakeQueryControls = {}, foldedTurnMs?: number) {
  const messages = new AsyncQueue<SDKMessage>();
  const prompts: SDKUserMessage[] = [];
  const fake = createFakeQuery((params) => {
    void (async () => {
      for await (const prompt of params.prompt as AsyncIterable<SDKUserMessage>) prompts.push(prompt);
      messages.close();
    })();
    return messages;
  }, controls);
  const session = startClaudeSession(input, fake.query, foldedTurnMs);
  return { session, messages, prompts, calls: fake.calls };
}

const init = sdkMessage({ type: 'system', subtype: 'init', session_id: 'sess-1' });

function success(result: string, isError = false) {
  return sdkMessage({ type: 'result', subtype: 'success', result, is_error: isError });
}

describe('startClaudeSession', () => {
  test('runs one turn, links the session and returns the summary', async () => {
    const { input, entries, sessions } = createInput();
    const { session, messages, calls } = startScripted(input);
    messages.push(init);
    messages.push(
      sdkMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        message: { content: [{ type: 'text', text: 'Done.' }] },
      })
    );
    messages.push(success('All done.'));
    expect(await session.done).toEqual({ outcome: 'completed', summary: 'All done.' });
    expect(sessions).toEqual(['sess-1']);
    expect(entries.map((entry) => entry.type)).toEqual(['user', 'agent']);
    expect(session.steer('too late')).toBe(false);
    const options = calls[0]?.options;
    expect(options?.disallowedTools).toEqual([]);
    expect(options).not.toHaveProperty('model');
    expect(options).not.toHaveProperty('resume');
  });

  test('a planner cannot edit, and the model and session to resume are passed on', async () => {
    const { input } = createInput({ role: 'planner' as RunRole, model: 'opus', resume: 'sess-0' });
    const { session, messages, calls } = startScripted(input);
    messages.push(success('ok'));
    await session.done;
    expect(calls[0]?.options).toMatchObject({
      model: 'opus',
      resume: 'sess-0',
      disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
    });
  });

  test('a steer extends the run by one turn, and a folded turn closes after a pause', async () => {
    const { input, entries } = createInput();
    const { session, messages, prompts } = startScripted(input, {}, 20);
    expect(session.steer('Also add tests')).toBe(true);
    messages.push(success('first'));
    messages.push(sdkMessage({ type: 'assistant', parent_tool_use_id: null, message: { content: [] } }));
    messages.push(success('second'));
    expect(await session.done).toEqual({ outcome: 'completed', summary: 'second' });
    expect(prompts.map((prompt) => prompt.message.content)).toEqual(['Build it', 'Also add tests']);
    expect(
      entries.filter((entry) => entry.type === 'user').map((entry) => entry.type === 'user' && entry.from)
    ).toEqual(['shinsa', 'you']);

    const folded = startScripted(createInput().input, {}, 20);
    folded.session.steer('one more');
    folded.messages.push(success('only one'));
    await Bun.sleep(60);
    folded.messages.close();
    expect(await folded.session.done).toEqual({ outcome: 'completed', summary: 'only one' });
  });

  test('an error result or an is_error success fails the run', async () => {
    const errored = startScripted(createInput().input);
    errored.messages.push(
      sdkMessage({ type: 'result', subtype: 'error_max_turns', errors: ['too many turns'] })
    );
    expect(await errored.session.done).toEqual({ outcome: 'failed', summary: 'too many turns' });

    const bare = startScripted(createInput().input);
    bare.messages.push(sdkMessage({ type: 'result', subtype: 'error_during_execution', errors: [] }));
    expect(await bare.session.done).toEqual({ outcome: 'failed', summary: 'error_during_execution' });

    const flagged = startScripted(createInput().input);
    flagged.messages.push(success('nope', true));
    expect(await flagged.session.done).toEqual({ outcome: 'failed', summary: 'nope' });
  });

  test('a crash is recorded as an error entry, and a crash after cancel is a cancel', async () => {
    const { input, entries } = createInput();
    const crashing = createFakeQuery(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('process exited')) }),
    }));
    expect(await startClaudeSession(input, crashing.query).done).toEqual({
      outcome: 'failed',
      summary: 'process exited',
    });
    expect(entries.at(-1)).toEqual({ type: 'error', text: 'process exited' });

    const gate = Promise.withResolvers<IteratorResult<SDKMessage>>();
    const cancelling = createFakeQuery(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => gate.promise }),
    }));
    const session = startClaudeSession(createInput().input, cancelling.query);
    await session.cancel();
    gate.reject(new Error('aborted'));
    expect(await session.done).toEqual({ outcome: 'cancelled', summary: null });
  });

  test('cancel interrupts the session, closes it when the interrupt fails, and ends as cancelled', async () => {
    let closed = false;
    const { session, messages } = startScripted(createInput().input, {
      interrupt: () => Promise.reject(new Error('not running')),
      close: () => {
        closed = true;
      },
    });
    session.steer('and more');
    messages.push(success('partial'));
    await Bun.sleep(5);
    await session.cancel();
    messages.close();
    expect(closed).toBe(true);
    expect(await session.done).toEqual({ outcome: 'cancelled', summary: 'partial' });
    expect(session.steer('ignored')).toBe(false);
  });
});
