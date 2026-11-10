import { describe, expect, test } from 'bun:test';
import type { ShinsaCommand, ShinsaState } from '@shinsa/core';
import type { AgentSessionInput, AgentSessionResult } from '../../src/agents/providers/index.ts';
import { createTestEvidence } from '../helpers/evidence.ts';
import { createTempDir, createTestConfig, until } from '../helpers/index.ts';
import { adaptStarter, type PromiseSession } from '../helpers/providers.ts';
import { createGate, createRepo, createRun, createStubEngine, createTask } from '../helpers/state.ts';
import { createSyncTranscripts } from '../helpers/transcripts.ts';
import { adaptInput, createSupervisor, type PromiseInput } from './supervisor/harness.ts';

const SIGN_IN = { url: 'https://vercel.com/login', reason: 'The deploy page asks me to sign in.' };

interface FakeSession {
  input: PromiseInput;
  finish: () => void;
}

function createSessions() {
  const started: FakeSession[] = [];
  const start = (input: AgentSessionInput): PromiseSession => {
    const done = Promise.withResolvers<AgentSessionResult>();
    started.push({
      input: adaptInput(input),
      finish: () => done.resolve({ outcome: 'completed', summary: 'done' }),
    });
    return {
      done: done.promise,
      steer: () => true,
      cancel: () => {
        done.resolve({ outcome: 'cancelled', summary: null });
        return Promise.resolve();
      },
    };
  };
  return { started, startSession: adaptStarter(start) };
}

function setup(patch: (state: ShinsaState) => void = () => undefined) {
  const sessions = createSessions();
  const stub = createStubEngine((state) => {
    state.repos['repo-1'] = createRepo();
    state.tasks['task-1'] = createTask({ worktreePath: createTempDir() });
    state.runs['run-1'] = createRun();
    patch(state);
  });
  const config = createTestConfig();
  const transcripts = createSyncTranscripts(config.transcriptsDir);
  const supervisor = createSupervisor(
    stub.engine,
    config,
    transcripts.service,
    createTestEvidence(config.evidenceDir),
    {
      startSession: sessions.startSession,
    }
  );
  return { ...stub, sessions, supervisor };
}

function listRequests(dispatched: ShinsaCommand[]) {
  return dispatched.flatMap((command) => (command.type === 'agent.request_browser_sign_in' ? [command] : []));
}

async function requested(context: ReturnType<typeof setup>, count = 1) {
  await until('the sign-in request', () => listRequests(context.dispatched).length === count);
  return listRequests(context.dispatched).at(-1)?.gateId ?? '';
}

function answer(context: ReturnType<typeof setup>, gateId: string, decision: 'approve' | 'reject') {
  context.update((state) => {
    state.gates[gateId] = createGate({
      id: gateId,
      type: 'browser_sign_in',
      status: 'answered',
      decision,
      response: null,
      browserSignIn: { url: SIGN_IN.url, site: 'vercel.com' },
    });
  });
  return context.supervisor.resolveQuestion(gateId);
}

describe('request_browser_sign_in', () => {
  test('opens the gate, waits for the human and tells the agent the browser is signed in', async () => {
    const context = setup();
    const run = context.supervisor.execute('run-1');
    await until('the session', () => context.sessions.started.length === 1);
    const { input, finish } = context.sessions.started[0] as FakeSession;
    const reply = input.tools.handle('request_browser_sign_in', SIGN_IN, new AbortController().signal);
    const gateId = await requested(context);
    expect(listRequests(context.dispatched)[0]).toMatchObject({ runId: 'run-1', ...SIGN_IN });
    await answer(context, gateId, 'approve');
    expect(await reply).toBe(
      'The human signed your project’s shared browser in to vercel.com. Open the page again and carry on. It stays signed in for later tasks of this project too.'
    );
    finish();
    await run;
  });

  test('a skip, a stopped step, a bad address or a refused gate each say so', async () => {
    const context = setup();
    const run = context.supervisor.execute('run-1');
    await until('the session', () => context.sessions.started.length === 1);
    const { input, finish } = context.sessions.started[0] as FakeSession;
    const live = new AbortController();
    const skipped = input.tools.handle('request_browser_sign_in', SIGN_IN, live.signal);
    await answer(context, await requested(context), 'reject');
    expect(await skipped).toContain('The human skipped signing in to vercel.com.');

    const stopping = new AbortController();
    const withdrawn = input.tools.handle('request_browser_sign_in', SIGN_IN, stopping.signal);
    await requested(context, 2);
    stopping.abort();
    expect(await withdrawn).toBe(
      'The sign-in request was withdrawn. Carry on without signing in, or ask again later.'
    );

    expect(
      input.tools.handle('request_browser_sign_in', { url: 'vercel.com', reason: 'Why' }, live.signal)
    ).rejects.toThrow('url must be the full http or https address');
    context.reject(
      (command) => command.type === 'agent.request_browser_sign_in',
      new Error('no shared browser')
    );
    expect(input.tools.handle('request_browser_sign_in', SIGN_IN, live.signal)).rejects.toThrow(
      'no shared browser'
    );
    finish();
    await run;
  });

  test('a session that was let go while waiting resumes with what the human did', async () => {
    const context = setup((state) => {
      state.gates.b1 = createGate({ id: 'b1', type: 'browser_sign_in', runId: 'run-1' });
    });
    const resumed = answer(context, 'b1', 'approve');
    await until('the resumed session', () => context.sessions.started.length === 1);
    expect(context.sessions.started[0]?.input.prompt).toContain(
      'You asked the human to sign your project’s shared browser in to vercel.com.\n\nThe human signed'
    );
    context.sessions.started[0]?.finish();
    await resumed;
  });

  test('when the asking run is over, the answer reaches the task as a message', async () => {
    const context = setup((state) => {
      state.runs['run-1'] = createRun({ endedAt: 5, status: 'completed' } as never);
      state.gates.b1 = createGate({ id: 'b1', type: 'browser_sign_in', runId: 'run-1' });
    });
    await answer(context, 'b1', 'reject');
    expect(context.dispatched).toContainEqual({
      type: 'message.deliver',
      taskId: 'task-1',
      text: expect.stringContaining('The human skipped signing in to vercel.com.'),
    });
  });
});
