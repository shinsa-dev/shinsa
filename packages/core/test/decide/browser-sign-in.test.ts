import { describe, expect, test } from 'bun:test';
import { BROWSER_SIGN_IN_LIMITS } from '../../src/browser/index.ts';
import { buildAll, createHarness, createTask, type Harness, PASSING, registerRepo } from '../harness.ts';

const URL = 'https://github.com/settings/profile';

function request(
  harness: Harness,
  runId: string,
  fields: { gateId?: string; url?: string; reason?: string } = {}
) {
  return harness.send({
    type: 'agent.request_browser_sign_in',
    runId,
    gateId: fields.gateId ?? 'b1',
    url: fields.url ?? URL,
    reason: fields.reason ?? 'The settings page asks me to sign in before it shows the new toggle.',
  });
}

function asking() {
  const harness = createHarness();
  const taskId = createTask(harness);
  const runId = harness.activeRun(taskId).id;
  request(harness, runId);
  return { harness, taskId, runId };
}

describe('asking for a browser sign-in', () => {
  test('opens a sign-in gate for the page’s site and keeps the run waiting', () => {
    const { harness, taskId, runId } = asking();
    expect(harness.state.gates.b1).toMatchObject({
      taskId,
      type: 'browser_sign_in',
      status: 'open',
      title: 'Sign in to github.com',
      body: 'The settings page asks me to sign in before it shows the new toggle.',
      runId,
      browserSignIn: { url: URL, site: 'github.com' },
    });
    expect(harness.activeRun(taskId).id).toBe(runId);
  });

  test('trims the address and the reason, and cuts a long reason to its limit', () => {
    const harness = createHarness();
    const runId = harness.activeRun(createTask(harness)).id;
    request(harness, runId, { url: `  http://localhost:5181/login  `, reason: ` ${'r'.repeat(400)} ` });
    expect(harness.state.gates.b1?.browserSignIn).toEqual({
      url: 'http://localhost:5181/login',
      site: 'localhost',
    });
    expect(harness.state.gates.b1?.body).toHaveLength(BROWSER_SIGN_IN_LIMITS.reason);
  });

  test('a repeat of the same request opens nothing new; another run’s gate id is refused', () => {
    const { harness, taskId, runId } = asking();
    expect(request(harness, runId).events).toHaveLength(0);
    const other = createTask(harness, { request: 'Other' });
    expect(() => request(harness, harness.activeRun(other).id)).toThrow('already exists');
    expect(harness.task(taskId).stage).toBe('planning');
  });

  test('refuses an address that is not a web page, a blank reason or an address over the limit', () => {
    const harness = createHarness();
    const runId = harness.activeRun(createTask(harness)).id;
    for (const url of ['github.com/login', 'file:///etc/hosts', 'javascript:alert(1)', ' ']) {
      expect(() => request(harness, runId, { url }), url).toThrow('full http or https address');
    }
    expect(() => request(harness, runId, { reason: '  ' })).toThrow('say why you need to sign in');
    const long = `https://example.com/${'a'.repeat(BROWSER_SIGN_IN_LIMITS.url)}`;
    expect(() => request(harness, runId, { url: long })).toThrow('full http or https address');
    expect(harness.state.gates.b1).toBeUndefined();
  });

  test('refuses a task with no project, which has no shared browser', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness, 'loose', null);
    const runId = harness.activeRun(createTask(harness, { repoId })).id;
    expect(() => request(harness, runId)).toThrow('no shared browser');
  });

  test('is the agent’s and the investigator’s tool, never the reviewer’s', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(() => request(harness, harness.activeRun(taskId).id)).toThrow('A reviewer cannot do that.');
  });
});

describe('answering a browser sign-in', () => {
  test('signed in closes it and hands the waiting agent its answer', () => {
    const { harness } = asking();
    const decision = harness.send({ type: 'gate.answer', gateId: 'b1', decision: 'approve', response: null });
    expect(harness.state.gates.b1).toMatchObject({ status: 'answered', decision: 'approve' });
    expect(decision.effects).toContainEqual({ kind: 'question.resolve', gateId: 'b1' });
  });

  test('skip closes it too, and the agent carries on without signing in', () => {
    const { harness } = asking();
    const decision = harness.send({ type: 'gate.answer', gateId: 'b1', decision: 'reject', response: null });
    expect(harness.state.gates.b1).toMatchObject({ status: 'answered', decision: 'reject' });
    expect(decision.effects).toContainEqual({ kind: 'question.resolve', gateId: 'b1' });
  });

  test('takes no written answer and no change request', () => {
    const { harness } = asking();
    for (const decision of ['reply', 'revise'] as const) {
      expect(() => harness.send({ type: 'gate.answer', gateId: 'b1', decision, response: 'Done.' })).toThrow(
        'Say you signed in, or skip it.'
      );
    }
    expect(harness.state.gates.b1?.status).toBe('open');
  });

  test('withdrawing the task’s questions withdraws it and wakes the waiting agent', () => {
    const { harness, taskId } = asking();
    const cancelled = harness.send({ type: 'task.cancel', taskId });
    expect(harness.state.gates.b1?.status).toBe('withdrawn');
    expect(cancelled.effects).toContainEqual({ kind: 'question.resolve', gateId: 'b1' });
  });
});
