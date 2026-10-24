import { describe, expect, test } from 'bun:test';
import type { ChatEvent, ChatNotice, RunRole } from '@shinsa/core';
import { type CodexSessionMode, startCodexSession } from '../../../../src/agents/providers/codex/session.ts';
import type { AgentSessionInput } from '../../../../src/agents/providers/index.ts';
import { createShinsaTools, type ToolHandler } from '../../../../src/agents/tools/index.ts';
import { FakeCodex, type FakeCodexStep } from '../../../helpers/codex.ts';
import { createTempDir, until } from '../../../helpers/index.ts';

interface Started {
  input: AgentSessionInput;
  entries: ChatEvent[];
  sessions: string[];
  tools: string[];
}

function createInput(
  role: RunRole = 'builder',
  overrides: Partial<AgentSessionInput> = {},
  handle?: ToolHandler
) {
  const entries: ChatEvent[] = [];
  const sessions: string[] = [];
  const tools: string[] = [];
  const handler: ToolHandler =
    handle ??
    ((name) => {
      tools.push(name);
      return Promise.resolve(`${name} accepted.`);
    });
  const input: AgentSessionInput = {
    role,
    cwd: createTempDir(),
    prompt: 'Do the work',
    model: 'gpt-6-astra',
    resume: null,
    defaultBranch: 'main',
    tools: createShinsaTools(role, handler),
    pluginDir: '/plugin',
    onSession: (id) => sessions.push(id),
    onEntry: (entry) => entries.push(entry),
    ...overrides,
  };
  return { input, entries, sessions, tools } satisfies Started;
}

const NOW = 1_800_000_000_000;

function start(codex: FakeCodex, started: Started, mode: CodexSessionMode = 'turns') {
  return startCodexSession(
    started.input,
    { runtime: codex.runtime, requestTimeoutMs: 50, heartbeatMs: 5, compactGraceMs: 5, now: () => NOW },
    mode
  );
}

const READY: FakeCodexStep = { plan: [{ step: 'Wait for a message', status: 'inProgress' }] };

function untilRunning(started: Started) {
  return until('the turn to run', () => started.entries.some((entry) => entry.type === 'tool_call'));
}

function notices(entries: ChatEvent[]): ChatNotice[] {
  return entries.flatMap((entry) => (entry.type === 'notice' ? [entry.notice] : []));
}

function texts(entries: ChatEvent[]) {
  return entries.flatMap((entry) => (entry.type === 'agent' ? [`${entry.phase}:${entry.text}`] : []));
}

const LIMITS_SPENT = {
  primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_900_000_000 },
  secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: 1_900_500_000 },
};

describe('a Codex turn', () => {
  test('runs on a new thread, hands over through Shinsa’s tools and reports usage and context', async () => {
    const codex = new FakeCodex();
    const started = createInput('planner');
    const result = await start(codex, started).done;
    expect(result).toMatchObject({
      outcome: 'completed',
      summary: 'Handed over.',
      usage: {
        inputTokens: 800,
        cacheReadTokens: 200,
        cacheWriteTokens: 0,
        outputTokens: 100,
        costUsd: 0.0132,
      },
      context: {
        usedTokens: 1_100,
        maxTokens: 200_000,
        cacheExpiresAt: NOW + 30 * 60_000,
        backgroundWork: false,
      },
    });
    expect(started.tools).toEqual(['propose_plan']);
    expect(started.sessions).toHaveLength(1);
    const [thread] = codex.requests('thread/start');
    expect(thread).toMatchObject({
      model: 'gpt-6-astra',
      approvalPolicy: 'never',
      sandbox: 'read-only',
      cwd: started.input.cwd,
      config: {
        'mcp_servers.shinsa': {
          tool_timeout_sec: 86_400,
          default_tools_approval_mode: 'approve',
        },
      },
    });
    expect(String(thread?.developerInstructions)).toContain('/plugin/skills/handover/SKILL.md');
    expect(texts(started.entries)).toEqual(['interim:Working on it.', 'final:Handed over.']);
    const call = started.entries.find((entry) => entry.type === 'tool_call');
    expect(call).toMatchObject({ tool: { kind: 'shinsa', name: 'propose_plan' } });
    expect(notices(started.entries).at(-1)).toEqual({
      kind: 'context',
      usedTokens: 1_100,
      maxTokens: 200_000,
      totalProcessedTokens: null,
    });
  });

  test('a builder may write and run commands, but Shinsa declines a commit and tells the agent why', async () => {
    const codex = new FakeCodex();
    codex.script('builder', [
      { run: 'bun test', output: '3 pass' },
      { run: 'git commit -m wip' },
      { write: 'notes.md', content: 'hello' },
      { tool: 'complete_phase', args: { summary: 'Done.', spots: [], judgement_calls: [] } },
      { say: 'Finished.' },
    ]);
    const started = createInput('builder');
    const result = await start(codex, started).done;
    expect(result.outcome).toBe('completed');
    expect(codex.requests('thread/start')[0]).toMatchObject({
      approvalPolicy: 'untrusted',
      sandbox: 'danger-full-access',
    });
    const approvals = codex.log.filter((entry) => entry.approval);
    expect(approvals.map((entry) => [entry.approval, entry.decision])).toEqual([
      ['bun test', 'accept'],
      ['git commit -m wip', 'decline'],
    ]);
    expect(codex.log.find((entry) => entry.patch)).toMatchObject({ patch: 'notes.md', decision: 'accept' });
    const warning = codex.requests('turn/steer').at(0);
    expect(String(warning?.prompt)).toContain('Shinsa blocked `git commit -m wip`');
    const results = started.entries.filter((entry) => entry.type === 'tool_result');
    expect(results.map((entry) => entry.status)).toEqual(['ok', 'error', 'ok', 'ok']);
    expect(started.entries).toContainEqual(
      expect.objectContaining({
        type: 'tool_call',
        tool: { kind: 'command', action: 'run', command: 'bun test', description: null },
      })
    );
  });

  test('a read-only role runs in Codex’s read-only sandbox, where a write never lands', async () => {
    const codex = new FakeCodex();
    codex.script('reviewer', [
      { write: 'sneaky.md', content: 'no' },
      { tool: 'report_review', args: { findings: [] } },
    ]);
    const started = createInput('reviewer');
    await start(codex, started).done;
    expect(codex.log.find((entry) => entry.patch)).toMatchObject({ patch: 'sneaky.md', decision: 'sandbox' });
    expect(await Bun.file(`${started.input.cwd}/sneaky.md`).exists()).toBe(false);
  });

  test('resumes the thread it is given', async () => {
    const codex = new FakeCodex();
    const first = createInput('planner');
    await start(codex, first).done;
    const threadId = first.sessions[0] ?? '';
    const second = createInput('planner', { resume: threadId });
    const result = await start(codex, second).done;
    expect(result.outcome).toBe('completed');
    expect(second.sessions).toEqual([threadId]);
    expect(codex.requests('thread/resume')).toEqual([expect.objectContaining({ threadId })]);
  });

  test('a thread Codex no longer has ends as a lost session, so Shinsa restores it from the transcript', async () => {
    const codex = new FakeCodex();
    const started = createInput('planner', { resume: 'thread-gone' });
    const result = await start(codex, started).done;
    expect(result.outcome).toBe('failed');
    expect(result.failure).toMatchObject({ class: 'session_lost', code: 'unknown_session' });
    expect(started.sessions).toEqual([]);
    expect(codex.requests('turn/start')).toEqual([]);
  });
});

describe('fast mode on Codex', () => {
  test('fast mode asks for Codex’s fast tier, standard speed sends an explicit standard tier', async () => {
    const codex = new FakeCodex();
    const fast = createInput('planner', { fastMode: true });
    expect((await start(codex, fast).done).outcome).toBe('completed');
    const standard = createInput('planner');
    expect((await start(codex, standard).done).outcome).toBe('completed');
    expect(codex.requests('thread/start').map((params) => params.serviceTier)).toEqual(['fast', null]);
    expect(notices(fast.entries).filter((notice) => notice.kind === 'fast_mode')).toEqual([]);
  });

  test('a model Codex runs only at standard speed is noted and the turn carries on', async () => {
    const codex = new FakeCodex({ standardOnly: true });
    const started = createInput('planner', { fastMode: true });
    expect((await start(codex, started).done).outcome).toBe('completed');
    expect(notices(started.entries)).toContainEqual({
      kind: 'fast_mode',
      status: 'unavailable',
      reason: 'tier_not_offered',
    });
  });
});

describe('how a Codex turn fails', () => {
  test('a usage limit reports the spent window the accounts read its reset from', async () => {
    const codex = new FakeCodex();
    codex.script('planner', [
      { limits: LIMITS_SPENT },
      { fail: { info: 'usageLimitExceeded', message: 'You have hit your usage limit.' } },
    ]);
    const started = createInput('planner');
    const result = await start(codex, started).done;
    expect(result.failure).toMatchObject({
      class: 'usage_limit',
      code: 'usageLimitExceeded',
      resetAt: null,
      retryable: true,
    });
    expect(notices(started.entries)).toContainEqual({
      kind: 'rate_limit',
      status: 'rejected',
      limit: 'five_hour',
      resetsAt: 1_900_000_000_000,
      utilization: 1,
    });
    expect(started.entries).toContainEqual({ type: 'error', text: 'Codex’s usage limit is reached.' });
  });

  test('a signed-out Codex asks for codex login', async () => {
    const codex = new FakeCodex();
    codex.script('planner', [{ fail: { info: 'unauthorized', message: 'Unauthorized' } }]);
    const result = await start(codex, createInput('planner')).done;
    expect(result.failure).toMatchObject({ class: 'auth', code: 'unauthorized' });
    expect(result.failure?.message).toContain('`codex login`');
  });

  test('a crashed app server ends the run as a transport failure naming what it printed', async () => {
    const codex = new FakeCodex();
    codex.script('planner', [{ say: 'Starting.' }, { crash: 'thread panicked at core/src/lib.rs' }]);
    const started = createInput('planner');
    const result = await start(codex, started).done;
    expect(result.failure).toMatchObject({ class: 'transport_error', retryable: true });
    expect(result.summary).toContain('thread panicked at core/src/lib.rs');
    expect(texts(started.entries)).toEqual(['interim:Starting.']);
  });

  test('a turn Codex interrupts by itself is an interruption to resume', async () => {
    const codex = new FakeCodex();
    codex.script('planner', [{ interrupted: true }]);
    const started = createInput('planner');
    const result = await start(codex, started).done;
    expect(result.failure).toMatchObject({ class: 'aborted', code: 'interrupted' });
    expect(notices(started.entries)).toContainEqual({ kind: 'interrupted' });
  });

  test('a Codex that cannot run fails before anything starts', async () => {
    const codex = new FakeCodex();
    const missing = createInput('planner');
    const result = await startCodexSession(missing.input, {
      runtime: {
        resolveExecutable: () =>
          Promise.resolve({ ok: false, reason: 'not_installed', message: 'Install Codex.', version: null }),
      },
    }).done;
    expect(result.failure).toMatchObject({
      class: 'setup_failed',
      code: 'not_installed',
      message: 'Install Codex.',
    });
    const broken = createInput('planner');
    const crashed = await startCodexSession(broken.input, {
      runtime: {
        resolveExecutable: () => Promise.resolve({ ok: true, path: '/no/such/codex', version: null }),
      },
    }).done;
    expect(crashed.failure?.class).toBe('setup_failed');
    expect(crashed.summary).toStartWith('Codex could not start:');
    expect(codex.log).toEqual([]);
  });
});

describe('steering and stopping', () => {
  test('a message steers the running turn', async () => {
    const codex = new FakeCodex();
    codex.script('planner', [READY, { waitSteer: true }, { tool: 'propose_plan', args: {} }]);
    const started = createInput('planner');
    const session = start(codex, started);
    await untilRunning(started);
    expect(session.steer('Use the second option.')).toBe(true);
    const result = await session.done;
    expect(result.outcome).toBe('completed');
    expect(String(codex.requests('turn/steer')[0]?.prompt)).toContain('Use the second option.');
    expect(texts(started.entries).at(0)).toEndWith('Use the second option.');
  });

  test('a message that cannot steer goes in as the next turn, and one after the end is refused', async () => {
    const codex = new FakeCodex();
    codex.script('planner', [{ say: 'First turn.' }], [{ say: 'Second turn.' }]);
    const started = createInput('planner');
    const session = start(codex, started);
    expect(session.steer('Before the thread exists', 'shinsa')).toBe(true);
    const result = await session.done;
    expect(result.outcome).toBe('completed');
    expect(codex.requests('turn/start').map((params) => params.prompt)).toEqual([
      'Do the work',
      'Before the thread exists',
    ]);
    expect(session.steer('Too late')).toBe(false);
  });

  test('cancelling interrupts the turn and returns the messages it never read', async () => {
    const codex = new FakeCodex();
    codex.script('planner', [READY, { hang: true }]);
    const started = createInput('planner');
    const session = start(codex, started);
    await untilRunning(started);
    await session.cancel();
    const result = await session.done;
    expect(result).toMatchObject({ outcome: 'cancelled', summary: null });
    expect(codex.requests('turn/interrupt')).toHaveLength(1);
    expect(session.steer('After the cancel')).toBe(false);
  });

  test('cancelling before the app server starts never starts it', async () => {
    const codex = new FakeCodex();
    const started = createInput('planner');
    const session = start(codex, started);
    await session.cancel();
    expect((await session.done).outcome).toBe('cancelled');
    expect(codex.log).toEqual([]);
  });
});

describe('requests and refusals from the app server', () => {
  test('Shinsa accepts its own server’s elicitations, declines others and a command it cannot read, and refuses what needs a person', async () => {
    const codex = new FakeCodex({ noise: true });
    codex.script('planner', [
      { elicit: 'shinsa' },
      { elicit: 'github' },
      { ask: 'item/tool/requestUserInput' },
      { ask: 'item/commandExecution/requestApproval' },
      { tool: 'propose_plan', args: {} },
    ]);
    const result = await start(codex, createInput('planner')).done;
    expect(result.outcome).toBe('completed');
    expect(
      codex.log.filter((entry) => entry.elicited).map((entry) => [entry.elicited, entry.action])
    ).toEqual([
      ['shinsa', 'accept'],
      ['github', 'decline'],
    ]);
    expect(JSON.stringify(codex.log.find((entry) => entry.asked)?.answer)).toContain(
      'Shinsa does not answer item/tool/requestUserInput'
    );
    expect(
      codex.log.find((entry) => entry.asked === 'item/commandExecution/requestApproval')?.answer
    ).toEqual({ decision: 'decline' });
  });

  test('when steering is refused the message is the next turn, and a refused warning is only logged', async () => {
    const codex = new FakeCodex({ refuse: ['turn/steer'] });
    codex.script(
      'builder',
      [{ run: 'git push' }, { tool: 'note', args: {} }, { say: 'First.' }],
      [{ say: 'Second.' }]
    );
    const held = Promise.withResolvers<string>();
    const noted = Promise.withResolvers<void>();
    const started = createInput('builder', {}, () => {
      noted.resolve();
      return held.promise;
    });
    const session = start(codex, started);
    await noted.promise;
    expect(session.steer('Also update the docs.')).toBe(true);
    held.resolve('Noted.');
    const result = await session.done;
    expect(result.outcome).toBe('completed');
    expect(codex.requests('turn/start').map((params) => String(params.prompt))).toEqual([
      'Do the work',
      expect.stringContaining('Also update the docs.'),
    ]);
  });

  test('a message waiting for the next turn comes back undelivered when the turn fails', async () => {
    const codex = new FakeCodex({ refuse: ['turn/steer'] });
    codex.script('builder', [
      { tool: 'note', args: {} },
      { fail: { info: 'internalServerError', message: 'Boom' } },
    ]);
    const held = Promise.withResolvers<string>();
    const noted = Promise.withResolvers<void>();
    const started = createInput('builder', {}, () => {
      noted.resolve();
      return held.promise;
    });
    const session = start(codex, started);
    await noted.promise;
    session.steer('Keep the old name.');
    held.resolve('Noted.');
    const result = await session.done;
    expect(result).toMatchObject({
      outcome: 'failed',
      failure: { class: 'provider_error', message: 'Boom' },
      undelivered: ['Keep the old name.'],
    });
  });

  test('a turn Codex will not start and an interrupt it refuses', async () => {
    const refusedTurn = new FakeCodex({ refuse: ['turn/start'] });
    const turn = await start(refusedTurn, createInput('planner')).done;
    expect(turn.failure).toMatchObject({ class: 'transport_error' });
    expect(turn.summary).toContain('fake codex refuses turn/start');

    const refusedInterrupt = new FakeCodex({ refuse: ['turn/interrupt'] });
    refusedInterrupt.script('planner', [READY, { hang: true }]);
    const started = createInput('planner');
    const session = start(refusedInterrupt, started);
    await untilRunning(started);
    await session.cancel();
    expect((await session.done).outcome).toBe('cancelled');
  });
});

describe('what the transcript shows', () => {
  test('plans, searches, subagents, other tools and compaction map into the chat protocol', async () => {
    const codex = new FakeCodex();
    const steps: FakeCodexStep[] = [
      {
        plan: [
          { step: 'Read', status: 'completed' },
          { step: 'Write', status: 'inProgress' },
          { step: '', status: 'pending' },
        ],
      },
      { plan: [] },
      { search: 'bun test coverage' },
      { image: '/tmp/shot.png' },
      { spawn: 'Survey the tests\nThen report.' },
      { other: 'custom_tool' },
      { run: `echo ${'x'.repeat(13_000)}` },
      { compact: true },
      { usage: { input: 50_000, output: 1_000, window: 0, last: 0 } },
      { usage: { input: 60_000, output: 2_000, window: 258_400, last: 40_000 } },
      { say: '   ' },
      { tool: 'propose_plan', args: {} },
    ];
    codex.script('planner', steps);
    const started = createInput('planner');
    const result = await start(codex, started).done;
    expect(result.outcome).toBe('completed');
    const calls = started.entries.flatMap((entry) => (entry.type === 'tool_call' ? [entry.tool] : []));
    expect(calls).toEqual([
      {
        kind: 'todo',
        todos: [
          { text: 'Read', status: 'completed' },
          { text: 'Write', status: 'in_progress' },
        ],
      },
      { kind: 'fetch', url: null, query: 'bun test coverage', prompt: null },
      { kind: 'read', path: '/tmp/shot.png', range: null },
      {
        kind: 'task',
        description: 'Survey the tests',
        prompt: 'Survey the tests\nThen report.',
        agent: 'gpt-5.6-luna',
      },
      { kind: 'other', name: 'custom_tool', args: { a: 1 } },
      { kind: 'command', action: 'run', command: `echo ${'x'.repeat(11_995)}…`, description: null },
      { kind: 'shinsa', name: 'propose_plan', args: {} },
    ]);
    expect(notices(started.entries).filter((notice) => notice.kind === 'compaction')).toHaveLength(1);
    expect(notices(started.entries).at(-1)).toEqual({
      kind: 'context',
      usedTokens: 40_000,
      maxTokens: 258_400,
      totalProcessedTokens: 62_000,
    });
    const spawn = started.entries.find((entry) => entry.type === 'tool_call' && entry.tool.kind === 'task');
    const callId = spawn?.type === 'tool_call' ? spawn.callId : '';
    expect(started.entries).toContainEqual({
      type: 'agent',
      phase: 'interim',
      text: 'From the subagent.',
      parentCallId: callId,
    });
    expect(texts(started.entries).filter((text) => text.startsWith('final:'))).toEqual([]);
    expect(
      started.entries.find((entry) => entry.type === 'tool_result' && entry.callId === callId)
    ).toMatchObject({
      status: 'error',
      output: 'From the subagent.',
    });
  });

  test('a tool Shinsa refuses shows as a failed call', async () => {
    const codex = new FakeCodex();
    codex.script('planner', [{ tool: 'complete_phase', args: {} }]);
    const started = createInput('planner');
    await start(codex, started).done;
    const result = started.entries.find((entry) => entry.type === 'tool_result');
    expect(result).toMatchObject({ status: 'error' });
    expect(codex.log.find((entry) => entry.tool === 'complete_phase')?.isError).toBe(true);
  });
});

function listCalls(entries: ChatEvent[]) {
  return entries.flatMap((entry) =>
    entry.type === 'tool_call'
      ? [{ callId: entry.callId, kind: entry.tool.kind, parent: entry.parentCallId ?? null }]
      : []
  );
}

function selectResult(entries: ChatEvent[], callId: string) {
  return entries.find((entry) => entry.type === 'tool_result' && entry.callId === callId);
}

describe('agents a Codex agent starts', () => {
  test('show inside the step’s turn under the call that started them, nested ones under theirs', async () => {
    const codex = new FakeCodex();
    codex.script('planner', [
      { agent: { thread: 'a1', say: 'Looked.', run: 'ls', nested: 'a2', usage: 500 } },
      { agent: { thread: 'a3', early: true, say: 'Early.', fails: true } },
      { tool: 'propose_plan', args: {} },
    ]);
    const started = createInput('planner');
    const result = await start(codex, started).done;
    expect(result.outcome).toBe('completed');
    expect(listCalls(started.entries)).toEqual([
      { callId: 'spawn-a1', kind: 'task', parent: null },
      { callId: 'a1-run', kind: 'command', parent: 'spawn-a1' },
      { callId: 'spawn-a2', kind: 'task', parent: 'spawn-a1' },
      { callId: 'spawn-a3', kind: 'task', parent: null },
      { callId: expect.any(String), kind: 'shinsa', parent: null },
    ]);
    expect(started.entries).toContainEqual({
      type: 'agent',
      phase: 'interim',
      text: 'Deeper.',
      parentCallId: 'spawn-a2',
    });
    expect(started.entries).toContainEqual({
      type: 'agent',
      phase: 'interim',
      text: 'Early.',
      parentCallId: 'spawn-a3',
    });
    expect(selectResult(started.entries, 'a1-run')).toMatchObject({ status: 'ok', parentCallId: 'spawn-a1' });
    expect(selectResult(started.entries, 'spawn-a1')).toMatchObject({ status: 'ok', output: 'Looked.' });
    expect(selectResult(started.entries, 'spawn-a2')).toMatchObject({
      status: 'ok',
      output: 'Deeper.',
      parentCallId: 'spawn-a1',
    });
    expect(selectResult(started.entries, 'spawn-a3')).toMatchObject({ status: 'error', output: 'Early.' });
    expect(started.entries.filter((entry) => entry.type === 'agent' && !entry.parentCallId)).toEqual([]);
    expect(result.subagentUsage).toEqual([
      {
        sessionId: 'a1',
        usage: {
          inputTokens: 500,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 10,
          costUsd: 0.000112,
        },
      },
    ]);
  });

  test('agents Codex reports by path show by their name, and one interrupted ends as stopped', async () => {
    const codex = new FakeCodex();
    codex.script('planner', [
      { activity: { thread: 't1', path: '/root/explorer', say: 'Found it.' } },
      { activity: { thread: 't2', path: '', interrupted: true } },
      { tool: 'propose_plan', args: {} },
    ]);
    const started = createInput('planner');
    await start(codex, started).done;
    const tasks = started.entries.flatMap((entry) =>
      entry.type === 'tool_call' && entry.tool.kind === 'task' ? [entry.tool] : []
    );
    expect(tasks).toEqual([
      { kind: 'task', description: 'explorer', prompt: null, agent: null },
      { kind: 'task', description: 'Agent', prompt: null, agent: null },
    ]);
    expect(started.entries).toContainEqual({
      type: 'agent',
      phase: 'interim',
      text: 'Found it.',
      parentCallId: 'agent:t1',
    });
    expect(selectResult(started.entries, 'agent:t1')).toMatchObject({ status: 'ok', output: 'Found it.' });
    expect(selectResult(started.entries, 'agent:t2')).toMatchObject({
      status: 'error',
      output: 'The agent stopped before it finished.',
    });
  });

  test('threads Shinsa never saw started stay out of the transcript, however much they say', async () => {
    const codex = new FakeCodex();
    codex.script('planner', [
      { stray: { thread: 'elsewhere', count: 600 } },
      { tool: 'propose_plan', args: {} },
    ]);
    const started = createInput('planner');
    expect((await start(codex, started).done).outcome).toBe('completed');
    expect(texts(started.entries)).toEqual([]);
    expect(listCalls(started.entries).map((call) => call.kind)).toEqual(['shinsa']);
  });
});

describe('compacting a Codex thread', () => {
  test('a compaction runs on its own turn, writes one notice and meters what it cost', async () => {
    const codex = new FakeCodex();
    const started = createInput('builder', { resume: null });
    const session = start(codex, started, 'compact');
    expect(session.steer('Not now.')).toBe(false);
    const result = await session.done;
    expect(result).toMatchObject({
      outcome: 'completed',
      summary: null,
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    expect(codex.requests('thread/compact/start')).toHaveLength(1);
    expect(codex.requests('turn/start')).toHaveLength(0);
    expect(notices(started.entries)).toEqual([
      { kind: 'compaction', trigger: 'manual', preTokens: null, summary: null },
    ]);
    expect(started.entries.some((entry) => entry.type === 'user')).toBe(false);
  });

  test('a compaction Codex never closes with a turn ends once its item is in', async () => {
    const codex = new FakeCodex({ compact: 'noTurn' });
    const result = await start(codex, createInput('builder'), 'compact').done;
    expect(result.outcome).toBe('completed');
  });

  test('a compaction that fails or is refused fails, and one that is stopped is cancelled', async () => {
    const failed = await start(new FakeCodex({ compact: 'fails' }), createInput('builder'), 'compact').done;
    expect(failed).toMatchObject({ outcome: 'failed', failure: { message: 'Compaction failed.' } });
    const refused = await start(
      new FakeCodex({ refuse: ['thread/compact/start'] }),
      createInput('builder'),
      'compact'
    ).done;
    expect(refused.failure).toMatchObject({ class: 'transport_error' });
    expect(refused.summary).toContain('Codex could not compact the thread');
    const silent = start(
      new FakeCodex({ ignore: ['thread/compact/start'] }),
      createInput('builder'),
      'compact'
    );
    await until('the compaction to be asked for', () => true);
    await silent.cancel();
    expect((await silent.done).outcome).toBe('cancelled');
  });

  test('a compaction whose codex stops while it waits fails, and one stopped while it waits is cancelled', async () => {
    const codex = new FakeCodex({ compact: 'noTurn' });
    const slow = { runtime: codex.runtime, requestTimeoutMs: 50, heartbeatMs: 5, compactGraceMs: 2_000 };
    const crashed = startCodexSession(createInput('builder').input, slow, 'compact');
    await until('the compaction to start', () => codex.requests('thread/compact/start').length === 1);
    const pid = codex.log.find((entry) => entry.method === 'thread/compact/start')?.pid ?? 0;
    process.kill(pid, 'SIGKILL');
    expect((await crashed.done).failure).toMatchObject({ class: 'transport_error' });
    const stopped = startCodexSession(createInput('builder').input, slow, 'compact');
    await until('the second compaction to start', () => codex.requests('thread/compact/start').length === 2);
    await stopped.cancel();
    expect((await stopped.done).outcome).toBe('cancelled');
  });

  test('with compaction off Codex never compacts on its own', async () => {
    const codex = new FakeCodex();
    await start(codex, createInput('planner', { compaction: 'off' })).done;
    await start(codex, createInput('planner', { compaction: 'eunoe_compact' })).done;
    const [off, on] = codex.requests('thread/start');
    expect(off?.config).toMatchObject({ model_auto_compact_token_limit: Number.MAX_SAFE_INTEGER });
    expect(on?.config).not.toHaveProperty('model_auto_compact_token_limit');
  });
});

describe('pricing a Codex turn', () => {
  test('a turn Codex moves to another model is priced as that model', async () => {
    const codex = new FakeCodex();
    codex.script('planner', [
      { reroute: 'gpt-5.6-luna' },
      { usage: { input: 100_000, output: 0, window: 400_000 } },
      { tool: 'propose_plan', args: {} },
    ]);
    const result = await start(codex, createInput('planner')).done;
    expect(result.usage?.costUsd).toBeCloseTo(0.02);
  });
});

describe('a Codex session’s instructions', () => {
  test('a run gets Shinsa’s instructions and the prompt is Shinsa’s', async () => {
    const codex = new FakeCodex();
    const started = createInput('planner');
    await start(codex, started).done;
    expect(String(codex.requests('thread/start')[0]?.developerInstructions)).toStartWith('# Shinsa');
    expect(started.entries[0]).toMatchObject({ type: 'user', from: 'shinsa' });
  });
});
