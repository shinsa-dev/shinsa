import { describe, expect, spyOn, test } from 'bun:test';
import type { HookInput, Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ChatEvent, ChatNotice, RunRole } from '@shinsa/core';
import { AsyncQueue } from '../../../../src/agents/providers/claude/async-queue.ts';
import { appendStderr } from '../../../../src/agents/providers/claude/classify.ts';
import type { ClaudeExecutable } from '../../../../src/agents/providers/claude/executable.ts';
import type { EunoeLink, EunoeWatcher } from '../../../../src/agents/providers/claude/index.ts';
import type { ClaudeProcess } from '../../../../src/agents/providers/claude/process.ts';
import { startClaudeSession } from '../../../../src/agents/providers/claude/session.ts';
import type { AgentSessionInput } from '../../../../src/agents/providers/index.ts';
import { SHINSA_INSTRUCTIONS } from '../../../../src/agents/providers/instructions.ts';
import { createShinsaTools } from '../../../../src/agents/tools/index.ts';
import { log } from '../../../../src/log/index.ts';
import { overrideEnv, until } from '../../../helpers/index.ts';
import {
  createFakeQuery,
  createFakeRuntime,
  emit,
  type FakeQueryControls,
  sdkMessage,
} from '../../../helpers/query.ts';

const ECHOING: ClaudeExecutable = { ok: true, path: '/bin/claude', version: '2.1.300' };

const SILENT: ClaudeExecutable = { ok: true, path: '/bin/claude', version: null };

function createInput(overrides: Partial<AgentSessionInput> = {}) {
  const entries: ChatEvent[] = [];
  const sessions: string[] = [];
  const handleTool = () => Promise.resolve('ok');
  const input: AgentSessionInput = {
    role: 'agent',
    readOnly: false,
    cwd: '/work',
    prompt: 'Build it',
    model: null,
    resume: null,
    defaultBranch: 'main',
    tools: createShinsaTools('agent', handleTool),
    pluginDir: '/plugin',
    onSession: (id) => sessions.push(id),
    onEntry: (entry) => entries.push(entry),
    ...overrides,
  };
  return { input, entries, sessions };
}

interface ScriptOptions {
  controls?: FakeQueryControls;
  executable?: ClaudeExecutable;
  foldedTurnMs?: number;
  contextTimeoutMs?: number;
  eunoe?: EunoeLink;
}

function startScripted(input: AgentSessionInput, options: ScriptOptions = {}) {
  const messages = new AsyncQueue<SDKMessage>();
  const prompts: SDKUserMessage[] = [];
  const fake = createFakeQuery((params) => {
    void (async () => {
      for await (const prompt of params.prompt as AsyncIterable<SDKUserMessage>) prompts.push(prompt);
      messages.close();
    })();
    return messages;
  }, options.controls);
  const session = startClaudeSession(input, {
    runtime: createFakeRuntime(fake.query, options.executable ?? SILENT),
    foldedTurnMs: options.foldedTurnMs,
    contextTimeoutMs: options.contextTimeoutMs ?? 20,
    now: () => 1_000,
    ...(options.eunoe ? { eunoe: options.eunoe } : {}),
  });
  return { session, messages, prompts, calls: fake.calls };
}

const init = sdkMessage({ type: 'system', subtype: 'init', session_id: 'sess-1' });

function success(result: string, extra: Record<string, unknown> = {}) {
  return sdkMessage({ type: 'result', subtype: 'success', result, is_error: false, ...extra });
}

function answering(ids: (string | undefined)[], result = 'ok', extra: Record<string, unknown> = {}) {
  return success(result, { user_message_uuids: ids.filter(Boolean), ...extra });
}

function notices(entries: ChatEvent[]) {
  return entries.flatMap((entry) => (entry.type === 'notice' ? [entry.notice] : []));
}

describe('starting a session', () => {
  test('runs one turn on the user’s claude, links the session and returns the summary', async () => {
    const { input, entries, sessions } = createInput();
    const { session, messages, calls } = startScripted(input);
    messages.push(init);
    messages.push(
      sdkMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        uuid: 'a1',
        message: { content: [{ type: 'text', text: 'Done.' }] },
      })
    );
    messages.push(success('All done.'));
    expect(await session.done).toEqual({
      outcome: 'completed',
      summary: 'All done.',
      failure: null,
      undelivered: [],
    });
    expect(sessions).toEqual(['sess-1']);
    expect(entries.map((entry) => entry.type)).toEqual(['user', 'agent']);
    expect(session.steer('too late')).toBe(false);
    const options = calls[0]?.options;
    expect(options).toMatchObject({
      pathToClaudeCodeExecutable: '/bin/claude',
      forwardSubagentText: true,
      disallowedTools: [],
    });
    expect(options).not.toHaveProperty('model');
    expect(options).not.toHaveProperty('resume');
  });

  test('a planner cannot edit, and the model and session to resume are passed on', async () => {
    const { input } = createInput({
      role: 'planner' as RunRole,
      readOnly: true,
      model: 'opus',
      resume: 'sess-0',
    });
    const { session, messages, calls } = startScripted(input);
    messages.push(success('ok'));
    await session.done;
    expect(calls[0]?.options).toMatchObject({
      model: 'opus',
      resume: 'sess-0',
      disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
    });
  });

  test('a fork resumes the source session as a copy, and only a resume can fork', async () => {
    const forked = startScripted(createInput({ resume: 'sess-0', fork: true }).input);
    forked.messages.push(success('ok'));
    await forked.session.done;
    expect(forked.calls[0]?.options).toMatchObject({ resume: 'sess-0', forkSession: true });
    const fresh = startScripted(createInput({ fork: true }).input);
    fresh.messages.push(success('ok'));
    await fresh.session.done;
    expect(fresh.calls[0]?.options).not.toHaveProperty('forkSession');
    const resumed = startScripted(createInput({ resume: 'sess-0' }).input);
    resumed.messages.push(success('ok'));
    await resumed.session.done;
    expect(resumed.calls[0]?.options).not.toHaveProperty('forkSession');
  });

  test('the round agent keeps one tool list: planning refuses edits through a hook, building has none', async () => {
    const planning = startScripted(createInput({ readOnly: true, resume: 'sess-0' }).input);
    planning.messages.push(success('ok'));
    await planning.session.done;
    const building = startScripted(createInput({ resume: 'sess-0' }).input);
    building.messages.push(success('ok'));
    await building.session.done;
    const planned = planning.calls[0]?.options;
    const built = building.calls[0]?.options;
    expect(planned?.disallowedTools).toEqual([]);
    expect(built?.disallowedTools).toEqual([]);
    expect(planned?.permissionMode).toBe('bypassPermissions');
    expect(built?.permissionMode).toBe('bypassPermissions');
    expect(planned?.hooks?.PreToolUse?.map((matcher) => matcher.matcher)).toEqual([
      'Bash',
      'Edit',
      'Write',
      'NotebookEdit',
      'MultiEdit',
    ]);
    expect(built?.hooks?.PreToolUse?.map((matcher) => matcher.matcher)).toEqual(['Bash']);
    const hook = planned?.hooks?.PreToolUse?.find((matcher) => matcher.matcher === 'Write')?.hooks[0];
    const signal = new AbortController().signal;
    const verdict = await hook?.(
      { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: {} } as unknown as HookInput,
      undefined,
      { signal }
    );
    expect(verdict).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });

  test('an account with its own Claude folder runs there, without inherited login overrides', async () => {
    const restore = overrideEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-inherited', HOME_MARKER: 'kept' });
    try {
      const { input } = createInput({ account: { id: 'acc-1', configDir: '/accounts/acc-1' } });
      const { session, messages, calls } = startScripted(input);
      messages.push(success('ok'));
      await session.done;
      const env = calls[0]?.options?.env ?? {};
      expect(env.CLAUDE_CONFIG_DIR).toBe('/accounts/acc-1');
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      expect(env.HOME_MARKER).toBe('kept');
      const { input: plain } = createInput({ account: { id: 'acc-2', configDir: null } });
      const second = startScripted(plain);
      second.messages.push(success('ok'));
      await second.session.done;
      expect(second.calls[0]?.options?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-inherited');
    } finally {
      restore();
    }
  });

  test('a missing or outdated claude fails the run as a setup failure before anything runs', async () => {
    const { input, entries } = createInput();
    const fake = createFakeQuery(() => new AsyncQueue<SDKMessage>());
    const session = startClaudeSession(input, {
      runtime: createFakeRuntime(fake.query, {
        ok: false,
        reason: 'outdated',
        message: 'Update Claude Code.',
      }),
    });
    expect(await session.done).toEqual({
      outcome: 'failed',
      summary: 'Update Claude Code.',
      failure: {
        class: 'setup_failed',
        message: 'Update Claude Code.',
        code: 'setup_failed',
        retryable: null,
        resetAt: null,
      },
    });
    expect(fake.calls).toHaveLength(0);
    expect(entries.at(-1)).toMatchObject({ type: 'error' });
  });

  test('a cancel before the process starts closes it at once and ends as cancelled', async () => {
    let closed = 0;
    const executable = Promise.withResolvers<ClaudeExecutable>();
    const fake = createFakeQuery(() => new AsyncQueue<SDKMessage>(), {
      close: () => {
        closed += 1;
      },
    });
    const session = startClaudeSession(createInput().input, {
      runtime: { runQuery: fake.query, resolveExecutable: () => executable.promise },
    });
    session.steer('before the start');
    await session.cancel();
    executable.resolve(SILENT);
    expect(await session.done).toEqual({
      outcome: 'cancelled',
      summary: null,
      undelivered: ['before the start'],
    });
    expect(closed).toBe(1);
  });
});

describe('prompts, ids and steering', () => {
  test('every prompt carries an id; a steer goes on the wire behind the notice and is stored as typed', async () => {
    const { input, entries } = createInput();
    const { session, messages, prompts } = startScripted(input, { executable: ECHOING });
    expect(session.steer('Also add tests')).toBe(true);
    await until('both prompts', () => prompts.length === 2);
    const [first, steer] = prompts;
    expect(first?.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(steer?.message.content).toStartWith('<system-message>');
    expect(steer?.message.content).toEndWith('Also add tests');
    expect(
      entries.filter((entry) => entry.type === 'user').map((entry) => entry.type === 'user' && entry.text)
    ).toEqual(['Build it', 'Also add tests']);
    messages.push(answering([first?.uuid, steer?.uuid], 'both'));
    expect(await session.done).toMatchObject({ outcome: 'completed', summary: 'both', undelivered: [] });
  });

  test('results are matched by echoed id: a result for another turn never ends this one', async () => {
    const { input } = createInput();
    const { session, messages, prompts } = startScripted(input, { executable: ECHOING });
    session.steer('Second thing');
    await until('both prompts', () => prompts.length === 2);
    messages.push(success('a background task finished'));
    messages.push(
      success('a scheduled wake-up failed', { is_error: true, origin: { kind: 'task-notification' } })
    );
    messages.push(answering([prompts[0]?.uuid], 'first'));
    await Bun.sleep(5);
    expect(session.steer('Third thing')).toBe(true);
    await until('three prompts', () => prompts.length === 3);
    messages.push(success('second', { user_message_uuid: prompts[1]?.uuid }));
    messages.push(answering([prompts[2]?.uuid], 'third'));
    expect(await session.done).toMatchObject({ outcome: 'completed', summary: 'third' });
  });

  test('an interrupted result without ids still ends the oldest prompt so a failed turn cannot hang', async () => {
    const { input } = createInput();
    const { session, messages } = startScripted(input, { executable: ECHOING });
    messages.push(
      sdkMessage({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] })
    );
    expect(await session.done).toMatchObject({ outcome: 'failed', summary: 'boom' });
  });

  test('a CLI that never echoes ids answers oldest first, and a folded steer counts as delivered after a pause', async () => {
    const { input } = createInput();
    const { session, messages } = startScripted(input, { foldedTurnMs: 20 });
    session.steer('folded in');
    messages.push(success('only one'));
    expect(await session.done).toEqual({
      outcome: 'completed',
      summary: 'only one',
      failure: null,
      undelivered: [],
    });
  });

  test('the pause a folded steer waits for neither keeps Shinsa alive nor outlives a crash', async () => {
    const set = spyOn(globalThis, 'setTimeout');
    const clear = spyOn(globalThis, 'clearTimeout');
    try {
      const crash = Promise.withResolvers<IteratorResult<SDKMessage>>();
      let reads = 0;
      const fake = createFakeQuery(() => ({
        [Symbol.asyncIterator]: () => ({
          next: () => {
            reads += 1;
            return reads === 1 ? Promise.resolve({ value: success('first'), done: false }) : crash.promise;
          },
        }),
      }));
      const session = startClaudeSession(createInput().input, {
        runtime: createFakeRuntime(fake.query),
        foldedTurnMs: 765_432,
        contextTimeoutMs: 20,
      });
      session.steer('folded in');
      await until('the pause', () => set.mock.calls.some(([, delay]) => delay === 765_432));
      const timer = set.mock.results[set.mock.calls.findIndex(([, delay]) => delay === 765_432)]
        ?.value as ReturnType<typeof setTimeout>;
      expect(timer.hasRef()).toBe(false);
      crash.reject(new Error('process exited'));
      expect(await session.done).toMatchObject({ outcome: 'failed', undelivered: ['folded in'] });
      expect(clear).toHaveBeenCalledWith(timer);
    } finally {
      set.mockRestore();
      clear.mockRestore();
    }
  });

  test('without ids, a steer gets the next result, and activity after a result keeps the turn open', async () => {
    const { input } = createInput();
    const { session, messages, prompts } = startScripted(input, { foldedTurnMs: 20 });
    session.steer('Also add tests');
    messages.push(success('first'));
    messages.push(
      sdkMessage({ type: 'assistant', parent_tool_use_id: null, uuid: 'a', message: { content: [] } })
    );
    messages.push(success('second'));
    expect(await session.done).toMatchObject({ outcome: 'completed', summary: 'second', undelivered: [] });
    expect(prompts).toHaveLength(2);
  });

  test('a steer that cut the running segment short does not end the turn; the steer’s own result does', async () => {
    const { input } = createInput();
    const { session, messages, prompts } = startScripted(input, { executable: ECHOING });
    session.steer('Stop and use blue');
    await until('both prompts', () => prompts.length === 2);
    messages.push(answering([prompts[0]?.uuid], '', { terminal_reason: 'aborted_streaming' }));
    messages.push(answering([prompts[1]?.uuid], 'Using blue.'));
    expect(await session.done).toMatchObject({ outcome: 'completed', summary: 'Using blue.' });
  });
});

describe('how a turn ends', () => {
  test('an abort reported as success, with nothing steered, is an interruption and fails the run', async () => {
    const { input, entries } = createInput();
    const { session, messages } = startScripted(input);
    messages.push(success('', { terminal_reason: 'aborted_tools' }));
    expect(await session.done).toMatchObject({ outcome: 'failed', failure: { class: 'aborted' } });
    expect(notices(entries)).toContainEqual({ kind: 'interrupted' });
  });

  test('a rejected rate limit ends the run as a usage limit with the reset time', async () => {
    const { input, entries } = createInput();
    const { session, messages } = startScripted(input);
    messages.push(
      sdkMessage({
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 7_200 },
      })
    );
    messages.push(success('Claude usage limit reached', { is_error: true, terminal_reason: 'api_error' }));
    expect(await session.done).toMatchObject({
      outcome: 'failed',
      summary: 'Claude’s usage limit is reached.',
      failure: { class: 'usage_limit', resetAt: 7_200_000 },
    });
    expect(notices(entries)).toContainEqual(
      expect.objectContaining({ kind: 'rate_limit', status: 'rejected' })
    );
  });

  test('a signed-out account ends the run as an auth failure', async () => {
    const { input } = createInput();
    const { session, messages } = startScripted(input);
    messages.push(
      sdkMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        uuid: 'a',
        error: 'authentication_failed',
        message: { content: [] },
      })
    );
    messages.push(success('Invalid API key', { is_error: true }));
    expect(await session.done).toMatchObject({ outcome: 'failed', failure: { class: 'auth' } });
  });

  test('a stream that ends without a result fails the run, and steers it never answered come back', async () => {
    const { input, entries } = createInput();
    const { session, messages } = startScripted(input);
    session.steer('never seen');
    messages.close();
    expect(await session.done).toEqual({
      outcome: 'failed',
      summary: 'The agent’s process ended before it finished its turn.',
      failure: {
        class: 'transport_error',
        message: 'The agent’s process ended before it finished its turn.',
        code: 'stream_ended',
        retryable: true,
        resetAt: null,
      },
      undelivered: ['never seen'],
    });
    expect(entries.at(-1)).toEqual({
      type: 'error',
      text: 'The agent’s process ended before it finished its turn.',
    });
  });

  test('a crash is a transport failure, and a crash after cancel is a cancel', async () => {
    const { input, entries } = createInput();
    const crashing = createFakeQuery(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('process exited')) }),
    }));
    expect(
      await startClaudeSession(input, { runtime: createFakeRuntime(crashing.query) }).done
    ).toMatchObject({
      outcome: 'failed',
      summary: 'process exited',
      failure: { class: 'transport_error' },
    });
    expect(entries.at(-1)).toEqual({ type: 'error', text: 'process exited' });

    const gate = Promise.withResolvers<IteratorResult<SDKMessage>>();
    const cancelling = createFakeQuery(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => gate.promise }),
    }));
    const session = startClaudeSession(createInput().input, { runtime: createFakeRuntime(cancelling.query) });
    await until('the query', () => cancelling.calls.length === 1);
    session.steer('lost in the cancel');
    await session.cancel();
    gate.reject(new Error('aborted'));
    expect(await session.done).toEqual({
      outcome: 'cancelled',
      summary: null,
      undelivered: ['lost in the cancel'],
    });
  });

  test('a login Claude could not refresh ends the run as an auth failure, even when the process then exits with an error', async () => {
    const expired = 'Failed to authenticate: OAuth session expired and could not be refreshed';
    const exited =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code prints the hook command unexpanded
      'Claude Code process exited with code 1. stderr: SessionEnd hook [node "${CLAUDE_PLUGIN_ROOT}/hooks/session-end-cleanup.mjs"] failed: Hook cancelled';
    const signedOut = sdkMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      uuid: 'a',
      error: 'authentication_failed',
      message: { model: '<synthetic>', content: [{ type: 'text', text: expired }] },
    });
    const crashing = (messages: SDKMessage[]) =>
      createFakeQuery(() =>
        (async function* () {
          yield* messages;
          throw new Error(exited);
        })()
      );
    const settled = createInput();
    const afterResult = crashing([init, signedOut, success(expired, { is_error: true })]);
    expect(
      await startClaudeSession(settled.input, {
        runtime: createFakeRuntime(afterResult.query),
        contextTimeoutMs: 20,
      }).done
    ).toMatchObject({
      outcome: 'failed',
      summary: 'Claude is signed out. Run `claude` in a terminal and sign in again.',
      failure: { class: 'auth', code: 'authentication_failed' },
    });
    expect(settled.entries.filter((entry) => entry.type === 'error')).toEqual([]);

    const unsettled = createInput();
    const beforeResult = crashing([init, signedOut]);
    expect(
      await startClaudeSession(unsettled.input, { runtime: createFakeRuntime(beforeResult.query) }).done
    ).toMatchObject({ outcome: 'failed', failure: { class: 'auth', code: 'authentication_failed' } });
    expect(unsettled.entries.at(-1)).toEqual({
      type: 'error',
      text: 'Claude Code stopped unexpectedly (exit code 1).',
    });

    const quiet = createInput();
    const noResult = startScripted(quiet.input);
    noResult.messages.push(signedOut);
    noResult.messages.close();
    expect(await noResult.session.done).toMatchObject({
      outcome: 'failed',
      failure: { class: 'auth', code: 'authentication_failed' },
    });
  });

  test('a process that exits on its own error keeps only the meaningful line of its stderr', async () => {
    const { input, entries } = createInput();
    const noisy = createFakeQuery(() =>
      (async function* () {
        yield init;
        throw new Error(
          'Claude Code process exited with code 1. stderr: SessionEnd hook [node cleanup.mjs] failed: Hook cancelled'
        );
      })()
    );
    expect(await startClaudeSession(input, { runtime: createFakeRuntime(noisy.query) }).done).toMatchObject({
      outcome: 'failed',
      summary: 'Claude Code stopped unexpectedly (exit code 1).',
      failure: { class: 'transport_error', message: 'Claude Code stopped unexpectedly (exit code 1).' },
    });
    expect(entries.at(-1)).toEqual({
      type: 'error',
      text: 'Claude Code stopped unexpectedly (exit code 1).',
    });
  });

  test('cancel interrupts the session, closes it when the interrupt fails, and ends as cancelled', async () => {
    let closed = false;
    const { session, messages } = startScripted(createInput().input, {
      controls: {
        interrupt: () => Promise.reject(new Error('not running')),
        close: () => {
          closed = true;
        },
      },
    });
    session.steer('and more');
    messages.push(success('partial'));
    await Bun.sleep(5);
    await session.cancel();
    messages.close();
    expect(closed).toBe(true);
    expect(await session.done).toEqual({
      outcome: 'cancelled',
      summary: 'partial',
      undelivered: ['and more'],
    });
    expect(session.steer('ignored')).toBe(false);
  });
});

interface FakeProcess {
  process: ClaudeProcess;
  terminated: () => number;
}

function createFakeProcess(stderr = ''): FakeProcess {
  let terminated = 0;
  return {
    process: {
      spawn: () => {
        throw new Error('not spawned in tests');
      },
      readStderr: () => stderr,
      terminate: () => {
        terminated += 1;
        return Promise.resolve();
      },
    },
    terminated: () => terminated,
  };
}

function startWedged(controls: FakeQueryControls = {}, child = createFakeProcess()) {
  const messages = new AsyncQueue<SDKMessage>();
  const fake = createFakeQuery(() => messages, {
    close: () => messages.close(),
    ...controls,
  });
  const { input, sessions } = createInput();
  const session = startClaudeSession(input, {
    runtime: createFakeRuntime(fake.query),
    contextTimeoutMs: 20,
    exitGraceMs: 20,
    interruptTimeoutMs: 20,
    createProcess: () => child.process,
    now: () => 1_000,
  });
  return { session, messages, child, sessions };
}

describe('a process that outlives its turn', () => {
  test('a process still running after its turn ended is stopped, and the turn keeps its outcome', async () => {
    const warn = spyOn(log, 'warn');
    try {
      const { session, messages, child } = startWedged();
      messages.push(init);
      messages.push(success('Handed over.'));
      expect(await session.done).toMatchObject({ outcome: 'completed', summary: 'Handed over.' });
      expect(child.terminated()).toBe(1);
      expect(warn).toHaveBeenCalledWith(
        '[Claude] The agent’s process did not exit after its turn, so Shinsa stopped it',
        { cwd: '/work' }
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('a stream that breaks when the stopped process goes away still ends the turn as it finished', async () => {
    const broken = Promise.withResolvers<IteratorResult<SDKMessage>>();
    const results = [success('Done.')];
    const fake = createFakeQuery(
      () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => {
            const next = results.shift();
            return next ? Promise.resolve({ value: next, done: false }) : broken.promise;
          },
        }),
      }),
      { close: () => broken.reject(new Error('Claude Code process terminated by signal SIGKILL')) }
    );
    const child = createFakeProcess();
    const session = startClaudeSession(createInput().input, {
      runtime: createFakeRuntime(fake.query),
      contextTimeoutMs: 20,
      exitGraceMs: 20,
      createProcess: () => child.process,
      now: () => 1_000,
    });
    expect(await session.done).toMatchObject({ outcome: 'completed', summary: 'Done.' });
    expect(child.terminated()).toBe(1);
  });

  test('a process that exits on its own in time is left alone', async () => {
    const child = createFakeProcess();
    const fake = createFakeQuery(() => emit(init, success('Quick.')));
    const session = startClaudeSession(createInput().input, {
      runtime: createFakeRuntime(fake.query),
      contextTimeoutMs: 20,
      exitGraceMs: 20,
      createProcess: () => child.process,
      now: () => 1_000,
    });
    expect(await session.done).toMatchObject({ outcome: 'completed' });
    await Bun.sleep(40);
    expect(child.terminated()).toBe(0);
  });

  test('cancel stops the process when the interrupt never answers', async () => {
    const { session, messages, child, sessions } = startWedged({
      interrupt: () => new Promise(() => undefined),
    });
    messages.push(init);
    await until('the session to start', () => sessions.length === 1);
    await session.cancel();
    expect(child.terminated()).toBe(1);
    expect(await session.done).toMatchObject({ outcome: 'cancelled' });
  });

  test('a process that dies on its own reports what it printed on stderr', async () => {
    const child = createFakeProcess('Error: Invalid API key');
    const fake = createFakeQuery(() => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error('Claude Code process exited with code 1')),
      }),
    }));
    const session = startClaudeSession(createInput().input, {
      runtime: createFakeRuntime(fake.query),
      createProcess: () => child.process,
    });
    expect(await session.done).toMatchObject({
      outcome: 'failed',
      summary: 'Claude Code stopped unexpectedly (exit code 1). It printed: Error: Invalid API key',
    });
  });

  test('stderr the SDK already reported is not added twice', () => {
    const reported = 'Claude Code process exited with code 1. stderr: boom';
    expect(appendStderr(reported, 'boom')).toBe(reported);
    expect(appendStderr('Claude Code process exited with code 1', '')).toBe(
      'Claude Code process exited with code 1'
    );
  });
});

describe('what a session cost', () => {
  test('the latest result’s running totals are the session’s usage, summed across its models', async () => {
    const { input } = createInput();
    const { session, messages } = startScripted(input);
    messages.push(init);
    messages.push(
      success('All done.', {
        total_cost_usd: 0.42,
        modelUsage: {
          opus: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadInputTokens: 100,
            cacheCreationInputTokens: 20,
            costUSD: 0.4,
          },
          haiku: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0.02,
          },
        },
      })
    );
    expect((await session.done).usage).toEqual({
      inputTokens: 11,
      outputTokens: 6,
      cacheReadTokens: 100,
      cacheWriteTokens: 20,
      costUsd: 0.42,
    });
  });

  test('a price the SDK cannot give stays unknown', async () => {
    const { input } = createInput();
    const { session, messages } = startScripted(input);
    const used = {
      inputTokens: 3,
      outputTokens: 2,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0,
    };
    messages.push(
      answering([undefined], 'first', { total_cost_usd: Number.NaN, modelUsage: { opus: used } })
    );
    expect((await session.done).usage).toEqual({
      inputTokens: 3,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: null,
    });
  });
});

describe('context usage and the account', () => {
  test('the context window is measured at the end of each turn, with the work processed along the way', async () => {
    const { input, entries } = createInput();
    const { session, messages } = startScripted(input, {
      controls: {
        getContextUsage: () => Promise.resolve({ totalTokens: 50_000, maxTokens: 200_000 }),
        accountInfo: () =>
          Promise.resolve({ email: 'me@example.com', organization: 'Acme', subscriptionType: 'max' }),
      },
    });
    messages.push(success('done', { usage: { input_tokens: 900_000, output_tokens: 100 } }));
    await session.done;
    const noted = notices(entries);
    expect(noted).toHaveLength(2);
    expect(noted).toContainEqual({
      kind: 'account',
      email: 'me@example.com',
      organization: 'Acme',
      plan: 'max',
    });
    expect(noted).toContainEqual({
      kind: 'context',
      usedTokens: 50_000,
      maxTokens: 200_000,
      totalProcessedTokens: 900_100,
    });
  });

  test('without a measurement the last step’s usage stands in; with neither nothing is noted', async () => {
    const fallback = createInput();
    const run = startScripted(fallback.input, {
      controls: {
        getContextUsage: () => Promise.reject(new Error('old CLI')),
        accountInfo: () => Promise.reject(new Error('no')),
      },
    });
    run.messages.push(
      sdkMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        uuid: 'a',
        message: { id: 'm', content: [], usage: { input_tokens: 40 } },
      })
    );
    run.messages.push(success('done', { modelUsage: { opus: { contextWindow: 1_000 } } }));
    await run.session.done;
    expect(notices(fallback.entries)).toEqual([
      { kind: 'context', usedTokens: 40, maxTokens: 1_000, totalProcessedTokens: null },
    ]);

    const slow = createInput();
    const hanging = startScripted(slow.input, {
      contextTimeoutMs: 5,
      controls: {
        getContextUsage: () => new Promise(() => undefined),
        accountInfo: () => Promise.resolve({}),
      },
    });
    hanging.messages.push(success('done', { usage: { input_tokens: 0 } }));
    await hanging.session.done;
    expect(notices(slow.entries)).toEqual([{ kind: 'account', email: null, organization: null, plan: null }]);

    const empty = createInput();
    const zero = startScripted(empty.input, {
      controls: { getContextUsage: () => Promise.resolve({ totalTokens: 0, maxTokens: 0 }) },
    });
    zero.messages.push(success('done'));
    await zero.session.done;
    expect(notices(empty.entries)).toEqual([]);
  });

  test('a measurement without a window keeps the window from the last step', async () => {
    const { input, entries } = createInput();
    const { session, messages } = startScripted(input, {
      controls: { getContextUsage: () => Promise.resolve({ totalTokens: 30, maxTokens: 0 }) },
    });
    messages.push(success('first', { modelUsage: { opus: { contextWindow: 500 } } }));
    await session.done;
    messages.close();
    expect(notices(entries)).toEqual([
      { kind: 'context', usedTokens: 30, maxTokens: 500, totalProcessedTokens: null },
    ]);
  });
});

describe('what an idle session leaves behind', () => {
  test('reports activity, its background work, the context size and when the prompt cache expires', async () => {
    let activity = 0;
    const { input } = createInput({ onActivity: () => (activity += 1) });
    const { session, messages } = startScripted(input, {
      controls: { getContextUsage: () => Promise.resolve({ totalTokens: 150_000, maxTokens: 200_000 }) },
    });
    messages.push(init);
    messages.push(
      sdkMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        tasks: [
          { task_id: 'shell-1', task_type: 'local_bash', description: 'dev server' },
          { task_id: 'watch', task_type: 'monitor', description: 'watcher', ambient: true },
        ],
      })
    );
    await until('the background work', () => session.hasPendingBackgroundWork?.() === true);
    messages.push(
      success('done', {
        usage: {
          input_tokens: 10,
          cache_creation: { ephemeral_1h_input_tokens: 9, ephemeral_5m_input_tokens: 0 },
        },
      })
    );
    expect(await session.done).toMatchObject({
      outcome: 'completed',
      context: {
        usedTokens: 150_000,
        maxTokens: 200_000,
        cacheExpiresAt: 1_000 + 60 * 60_000,
        backgroundWork: true,
      },
    });
    expect(activity).toBe(3);
  });

  test('work that ends clears the pin, and a five-minute cache expires five minutes on', async () => {
    const { input } = createInput();
    const { session, messages } = startScripted(input);
    messages.push(
      sdkMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        tasks: [{ task_id: 'shell-1', task_type: 'local_bash', description: 'tests' }],
      })
    );
    messages.push(sdkMessage({ type: 'system', subtype: 'background_tasks_changed', tasks: [] }));
    messages.push(
      success('done', {
        usage: { cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 4 } },
      })
    );
    expect(await session.done).toMatchObject({
      context: {
        usedTokens: null,
        maxTokens: null,
        cacheExpiresAt: 1_000 + 5 * 60_000,
        backgroundWork: false,
      },
    });
    expect(session.hasPendingBackgroundWork?.()).toBe(false);
  });
});

function createEunoe(up = true) {
  const watching: { sessionId: string; watcher: EunoeWatcher; stopped: boolean }[] = [];
  const link: EunoeLink = {
    ensure: () =>
      Promise.resolve(
        up
          ? { ok: true as const, url: 'http://127.0.0.1:40001', dir: '/data/eunoe' }
          : { ok: false as const, reason: 'eunoe did not start within 15 s.' }
      ),
    watch: (sessionId, watcher) => {
      const entry = { sessionId, watcher, stopped: false };
      watching.push(entry);
      return () => {
        entry.stopped = true;
      };
    },
  };
  return { link, watching };
}

describe('compaction and fast mode', () => {
  test('a session goes through eunoe in its mode, with Claude Code’s compaction off and fast mode on', async () => {
    const { link } = createEunoe();
    const { input } = createInput({
      compaction: 'eunoe_compact',
      fastMode: true,
      account: { id: 'acc-1', configDir: '/accounts/acc-1' },
    });
    const { session, messages, calls } = startScripted(input, { eunoe: link });
    messages.push(success('ok'));
    await session.done;
    const options = calls[0]?.options;
    expect(options?.settings).toEqual({
      fastMode: true,
      autoCompactEnabled: false,
      env: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:40001',
        CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE: '1000000000',
        EUNOE_DIR: '/data/eunoe',
      },
    });
    expect(options?.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:40001',
      CLAUDE_CONFIG_DIR: '/accounts/acc-1',
      EUNOE_DIR: '/data/eunoe',
    });
  });

  test('without a choice a session talks to Anthropic directly, Claude Code compacts, and fast mode is off', async () => {
    const { input, entries } = createInput();
    const { session, messages, calls } = startScripted(input);
    messages.push(success('ok'));
    await session.done;
    expect(calls[0]?.options?.settings).toEqual({
      fastMode: false,
      autoCompactEnabled: true,
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE: '' },
    });
    expect(notices(entries)).toEqual([]);
  });

  test('when eunoe is down the session says so and runs directly with Claude Code compacting', async () => {
    const { link, watching } = createEunoe(false);
    const { input, entries } = createInput({ compaction: 'eunoe_default' });
    const { session, messages, calls } = startScripted(input, { eunoe: link });
    messages.push(init);
    messages.push(success('ok'));
    expect((await session.done).outcome).toBe('completed');
    expect(notices(entries)).toEqual([
      { kind: 'proxy', proxy: 'eunoe', status: 'unavailable', detail: 'eunoe did not start within 15 s.' },
    ]);
    expect(calls[0]?.options?.settings).toMatchObject({ autoCompactEnabled: true });
    expect(watching).toEqual([]);
  });

  test('eunoe’s folds of the session land in its transcript until the session ends', async () => {
    const { link, watching } = createEunoe();
    const { input, entries } = createInput({ compaction: 'eunoe_compact' });
    const { session, messages } = startScripted(input, { eunoe: link });
    messages.push(init);
    await until('the watch', () => watching.length === 1);
    messages.push(sdkMessage({ type: 'system', subtype: 'init', session_id: 'sess-1' }));
    await until('the second watch', () => watching.length === 2);
    expect(watching[0]?.stopped).toBe(true);
    const fold = {
      kind: 'compaction' as const,
      trigger: 'fold' as const,
      preTokens: null,
      summary: null,
      by: 'eunoe' as const,
    };
    watching[1]?.watcher.notice(fold);
    messages.push(success('ok'));
    await session.done;
    expect(watching.map((entry) => entry.sessionId)).toEqual(['sess-1', 'sess-1']);
    expect(watching[1]?.stopped).toBe(true);
    expect(notices(entries)).toContainEqual(fold);
  });

  test('a thread eunoe reports stuck ends the turn as a full context window, once, so the next attempt starts fresh', async () => {
    const { link, watching } = createEunoe();
    const { input, entries } = createInput({ compaction: 'eunoe_compact' });
    const interrupts: string[] = [];
    const { session, messages } = startScripted(input, {
      eunoe: link,
      controls: {
        interrupt: () => {
          interrupts.push('interrupt');
          return Promise.resolve();
        },
      },
    });
    messages.push(init);
    await until('the watch', () => watching.length === 1);
    watching[0]?.watcher.stuck();
    watching[0]?.watcher.stuck();
    const result = await session.done;
    expect(result).toMatchObject({
      outcome: 'failed',
      summary: 'Claude stopped: the conversation no longer fits the model’s context window.',
      failure: { class: 'context_window_full', code: 'eunoe_stuck' },
    });
    expect(interrupts).toEqual(['interrupt']);
    expect(entries.filter((entry) => entry.type === 'error')).toHaveLength(1);
  });

  test('a stuck report after the run was cancelled leaves it cancelled', async () => {
    const { link, watching } = createEunoe();
    const { input } = createInput({ compaction: 'eunoe_compact' });
    const { session, messages } = startScripted(input, { eunoe: link });
    messages.push(init);
    await until('the watch', () => watching.length === 1);
    await session.cancel();
    watching[0]?.watcher.stuck();
    expect((await session.done).outcome).toBe('cancelled');
  });

  test('fast mode that cannot run is noted when the session starts, and the run carries on', async () => {
    const cases = [
      [{ fast_mode_state: 'off', fast_mode_disabled_reason: 'model_not_allowed' }, true],
      [{ fast_mode_state: 'cooldown' }, true],
      [{ fast_mode_state: 'on' }, true],
      [{}, true],
      [{ fast_mode_state: 'off', fast_mode_disabled_reason: 'preference' }, false],
    ] as const;
    const seen: ChatNotice[][] = [];
    for (const [extra, fastMode] of cases) {
      const { input, entries } = createInput({ fastMode });
      const { session, messages } = startScripted(input);
      messages.push(sdkMessage({ type: 'system', subtype: 'init', session_id: 'sess-1', ...extra }));
      messages.push(success('ok'));
      expect((await session.done).outcome).toBe('completed');
      seen.push(notices(entries));
    }
    expect(seen).toEqual([
      [{ kind: 'fast_mode', status: 'unavailable', reason: 'model_not_allowed' }],
      [{ kind: 'fast_mode', status: 'cooldown', reason: null }],
      [],
      [],
      [],
    ]);
  });
});

async function readCachedPrefix(options: Options | undefined) {
  const servers = (options?.mcpServers ?? {}) as unknown as Record<string, { instance: Server }>;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'prefix', version: '1.0.0' });
  await servers.shinsa?.instance.connect(serverSide);
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  return JSON.stringify({
    tools,
    systemPrompt: options?.systemPrompt,
    disallowedTools: options?.disallowedTools,
    skills: options?.skills,
    plugins: options?.plugins,
    settings: options?.settings,
    permissionMode: options?.permissionMode,
  });
}

describe('the cached prefix of a task’s session', () => {
  test('is the same for planning, building, fixing, operating and every other kind of work on the task', async () => {
    const turns: { role: RunRole; readOnly: boolean }[] = [
      { role: 'agent', readOnly: true },
      { role: 'agent', readOnly: false },
      { role: 'answerer', readOnly: true },
      { role: 'investigator', readOnly: false },
      { role: 'researcher', readOnly: true },
    ];
    const prefixes = new Set<string>();
    for (const turn of turns) {
      const tools = createShinsaTools(turn.role, () => Promise.resolve('ok'));
      const scripted = startScripted(createInput({ ...turn, tools, resume: 'sess-0' }).input);
      scripted.messages.push(success('ok'));
      await scripted.session.done;
      prefixes.add(await readCachedPrefix(scripted.calls[0]?.options));
    }
    expect(prefixes.size).toBe(1);
  });
});

describe('a session’s instructions', () => {
  test('a run gets Shinsa’s instructions and the prompt is Shinsa’s', async () => {
    const { input, entries } = createInput();
    const { session, messages, calls } = startScripted(input);
    messages.push(success('ok'));
    await session.done;
    expect(calls[0]?.options?.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: SHINSA_INSTRUCTIONS,
      excludeDynamicSections: true,
      snapshot: true,
    });
    expect(entries[0]).toMatchObject({ type: 'user', from: 'shinsa' });
  });
});
