import { describe, expect, test } from 'bun:test';
import { isTaskLive } from '../../src/decide/liveness.ts';
import {
  type CommandOf,
  DELEGATION_LIMITS,
  type DelegateRole,
  type DelegationMode,
  listActiveRuns,
  listChildRuns,
  listLiveRuns,
  listOpenGates,
  type Run,
} from '../../src/index.ts';
import {
  completePhase,
  createHarness,
  createTask,
  type Harness,
  linkSession,
  proposePlan,
} from '../harness.ts';

interface DelegateOptions {
  role?: DelegateRole;
  mode?: DelegationMode;
  key?: string;
  isolation?: 'shared' | 'worktree';
  baseCommit?: string | null;
  title?: string;
  provider?: string | null;
  model?: string | null;
}

function building() {
  const harness = createHarness();
  const taskId = createTask(harness);
  proposePlan(harness, taskId);
  return { harness, taskId };
}

let keys = 0;

function delegate(harness: Harness, parentId: string, options: DelegateOptions = {}) {
  const command: CommandOf<'agent.delegate'> = {
    type: 'agent.delegate',
    runId: parentId,
    requestKey: options.key ?? `key-${++keys}`,
    title: options.title ?? 'Check the copy',
    brief: 'Read the strings in src/copy.ts and report any that break the copy rules.',
    role: options.role ?? 'reviewer',
    mode: options.mode ?? 'async',
    isolation: options.isolation ?? 'shared',
    baseCommit: options.baseCommit ?? null,
    provider: options.provider ?? null,
    model: options.model ?? null,
  };
  const before = new Set(Object.keys(harness.state.runs));
  harness.send(command);
  const id = Object.keys(harness.state.runs).find((runId) => !before.has(runId));
  return id ? (harness.state.runs[id] as Run) : null;
}

function child(harness: Harness, parentId: string, options: DelegateOptions = {}) {
  const run = delegate(harness, parentId, options);
  if (!run) throw new Error('no delegated run was started');
  return run;
}

function finish(harness: Harness, runId: string, summary = 'Every string follows the rules.') {
  return harness.send({ type: 'run.end', runId, outcome: 'completed', summary });
}

function current(harness: Harness, runId: string) {
  const found = harness.state.runs[runId];
  if (!found) throw new Error(`no run ${runId}`);
  return found;
}

function lastClaim(harness: Harness, runId: string) {
  return current(harness, runId).cohort?.claim ?? null;
}

describe('delegating a task', () => {
  test('starts the delegated agent from its brief alone, as its own run on the task, at once', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    expect(delegated).toMatchObject({
      taskId,
      role: 'reviewer',
      status: 'running',
      phaseIndex: null,
      resume: false,
      provider: 'claude',
      delegation: {
        parentRunId: parent.id,
        depth: 1,
        title: 'Check the copy',
        mode: 'async',
        wake: 'always',
        isolation: 'shared',
        baseCommit: null,
        delivery: 'none',
        question: null,
      },
    });
    expect(delegated.prompt).toContain('Read the strings in src/copy.ts');
    expect(delegated.prompt).toContain('Your role: reviewer. Do not change any file.');
    expect(delegated.prompt).not.toContain('Find the overflow');
    expect(harness.effectsOf('run.execute').at(-1)).toEqual({ kind: 'run.execute', runId: delegated.id });
    expect(listActiveRuns(harness.state, taskId).map((active) => active.id)).toEqual([parent.id]);
    expect(listLiveRuns(harness.state, taskId).map((live) => live.id)).toEqual([parent.id, delegated.id]);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'agent',
      kind: 'delegation',
      text: 'Delegated “Check the copy” to a reviewer',
      runId: parent.id,
    });
  });

  test('uses the provider and model it was given, or the model set for its role', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    expect(child(harness, parent.id, { role: 'builder' }).model).toBe('opus');
    expect(child(harness, parent.id, { provider: 'codex', model: 'gpt-5' })).toMatchObject({
      provider: 'codex',
      model: 'gpt-5',
    });
    expect(child(harness, parent.id, { provider: 'codex' })).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-astra',
    });
  });

  test('without a provider the child runs on the one set for its role', () => {
    const { harness, taskId } = building();
    harness.send({ type: 'settings.change', patch: { agentProviders: { reviewer: 'codex' } } });
    const parent = harness.activeRun(taskId);
    expect(child(harness, parent.id, { role: 'reviewer' })).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-astra',
    });
  });

  test('the same client request id returns the delegation it already started', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const first = child(harness, parent.id, { key: 'round-1' });
    expect(delegate(harness, parent.id, { key: 'round-1' })).toBeNull();
    expect(listChildRuns(harness.state, parent.id).map((delegated) => delegated.id)).toEqual([first.id]);
    finish(harness, first.id);
    expect(delegate(harness, parent.id, { key: 'round-1' })).toBeNull();
    expect(child(harness, parent.id, { key: 'round-2' }).id).not.toBe(first.id);
  });

  test('refuses a role outside planner, builder and reviewer', () => {
    const { harness, taskId } = building();
    expect(() => child(harness, harness.activeRun(taskId).id, { role: 'answerer' as DelegateRole })).toThrow(
      'Delegate to one of: planner, builder, reviewer.'
    );
  });

  test('a child is never broader than its parent: a read-only agent only delegates read-only roles', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const planning = harness.activeRun(taskId);
    expect(() => child(harness, planning.id, { role: 'builder' })).toThrow(
      'While you plan you cannot change files, so the agents you delegate to cannot either.'
    );
    const researcher = child(harness, planning.id, { role: 'planner' });
    expect(() => child(harness, researcher.id, { role: 'builder' })).toThrow('A planner cannot change files');
    expect(child(harness, researcher.id, { role: 'reviewer' }).delegation?.depth).toBe(2);
  });

  test('the round agent may delegate writing work once it builds', () => {
    const { harness, taskId } = building();
    expect(child(harness, harness.activeRun(taskId).id, { role: 'builder' }).delegation?.depth).toBe(1);
  });

  test('delegations nest at most three deep', () => {
    const { harness, taskId } = building();
    const first = child(harness, harness.activeRun(taskId).id, { role: 'builder' });
    const second = child(harness, first.id, { role: 'builder' });
    const third = child(harness, second.id, { role: 'builder' });
    expect(third.delegation?.depth).toBe(DELEGATION_LIMITS.depth);
    expect(third.prompt).toContain('you cannot delegate it further');
    expect(() => child(harness, third.id)).toThrow(
      'Delegations nest at most 3 deep, and this agent is already at that depth.'
    );
  });

  test('delegations at once are unlimited by default', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    for (let index = 0; index < 20; index += 1) child(harness, parent.id);
    expect(listChildRuns(harness.state, parent.id)).toHaveLength(20);
  });

  test('a set limit caps the delegations running at once under one step, counted across the whole tree', () => {
    const { harness, taskId } = building();
    harness.send({ type: 'settings.change', patch: { delegationLimit: 8 } });
    const parent = harness.activeRun(taskId);
    const nested = child(harness, parent.id, { role: 'builder' });
    for (let index = 0; index < 6; index += 1) child(harness, parent.id);
    child(harness, nested.id);
    expect(() => child(harness, nested.id)).toThrow(
      '8 delegations under this step are still running, and the human allows 8 at once (the Delegations at once setting).'
    );
    expect(() => child(harness, parent.id)).toThrow('the Delegations at once setting');
    finish(harness, listChildRuns(harness.state, parent.id).at(-1)?.id ?? '');
    expect(child(harness, parent.id).delegation?.depth).toBe(1);
  });

  test('isolation needs the task’s worktree and the parent’s commit', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    expect(() => child(harness, parent.id, { isolation: 'worktree' })).toThrow(
      'This task has no commit to copy into a separate checkout.'
    );
    const isolated = child(harness, parent.id, {
      isolation: 'worktree',
      baseCommit: 'abc123',
      role: 'builder',
    });
    expect(isolated.delegation).toMatchObject({ isolation: 'worktree', baseCommit: 'abc123' });
    expect(isolated.prompt).toContain('your own checkout of the delegating agent’s last commit');
    const shared = child(harness, parent.id, { baseCommit: 'abc123', role: 'builder' });
    expect(shared.delegation?.baseCommit).toBeNull();
    expect(shared.prompt).toContain('Change only what the brief asks for.');
  });

  test('a question task cannot isolate: it has no worktree', () => {
    const harness = createHarness();
    const repoId = createTask(harness) && Object.keys(harness.state.repos)[0];
    harness.send({ type: 'task.create', request: 'How does it work?', repoId: repoId ?? null, mode: 'ask' });
    const taskId = Object.values(harness.state.tasks).find((task) => task.mode === 'ask')?.id ?? '';
    harness.send({
      type: 'task.triage',
      taskId,
      title: 'How it works',
      repoId: repoId ?? '',
      size: 'small',
      branch: 'ask',
      waitsOn: [],
    });
    harness.send({ type: 'config.record', taskId, problems: [] });
    const answerer = harness.activeRun(taskId);
    expect(answerer.role).toBe('answerer');
    expect(() => child(harness, answerer.id, { isolation: 'worktree', baseCommit: 'abc' })).toThrow(
      'no commit to copy'
    );
    expect(() => child(harness, answerer.id, { role: 'builder' })).toThrow('An answerer cannot change files');
    expect(child(harness, answerer.id, { role: 'planner' }).delegation?.isolation).toBe('shared');
  });
});

describe('the account a delegated agent runs on', () => {
  test('a step rerun on a chosen account delegates onto that account, not the pool', () => {
    const { harness, taskId } = building();
    const account = { id: 'acc-work', email: 'work@example.com' };
    harness.send({ type: 'task.retry', taskId, account });
    const parent = harness.activeRun(taskId);
    expect(parent.account).toEqual(account);
    expect(child(harness, parent.id).account).toEqual(account);
  });

  test('a step on the pool delegates onto the pool', () => {
    const { harness, taskId } = building();
    expect(child(harness, harness.activeRun(taskId).id).account).toBeUndefined();
  });
});

describe('delivering results', () => {
  test('a finished result is steered into the parent’s running turn and marked delivered once confirmed', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    finish(harness, delegated.id, '  No problems found.  ');
    expect(current(harness, delegated.id)).toMatchObject({
      outcome: 'completed',
      summary: 'No problems found.',
    });
    const claim = lastClaim(harness, parent.id);
    expect(claim).toEqual({ generation: 1, items: [`result:${delegated.id}`], via: 'steer' });
    expect(harness.lastEffect('delegation.steer')).toEqual({
      kind: 'delegation.steer',
      runId: parent.id,
      generation: 1,
    });
    harness.send({
      type: 'delegation.record_delivery',
      runId: parent.id,
      generation: 1,
      items: claim?.items ?? [],
    });
    expect(current(harness, delegated.id).delegation?.delivery).toBe('delivered');
    expect(lastClaim(harness, parent.id)).toBeNull();
    expect(current(harness, parent.id).cohort?.nextGeneration).toBe(2);
  });

  test('results that finish while a delivery is on its way join it; a stale confirmation changes nothing', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const first = child(harness, parent.id);
    const second = child(harness, parent.id);
    finish(harness, first.id);
    const steers = harness.effectsOf('delegation.steer').length;
    finish(harness, second.id);
    expect(harness.effectsOf('delegation.steer')).toHaveLength(steers);
    expect(lastClaim(harness, parent.id)?.items).toEqual([`result:${first.id}`, `result:${second.id}`]);
    const stale = harness.send({
      type: 'delegation.record_delivery',
      runId: parent.id,
      generation: 7,
      items: [],
    });
    expect(stale.events).toEqual([]);
    harness.send({
      type: 'delegation.record_delivery',
      runId: parent.id,
      generation: 1,
      items: [`result:${first.id}`],
    });
    expect(current(harness, first.id).delegation?.delivery).toBe('delivered');
    expect(current(harness, second.id).delegation?.delivery).toBe('none');
    expect(lastClaim(harness, parent.id)).toEqual({
      generation: 2,
      items: [`result:${second.id}`],
      via: 'steer',
    });
  });

  test('a parent that ends its turn while its delegations run waits for them, and the next result wakes it', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const reason = harness.task(taskId).stageReason;
    const first = child(harness, parent.id);
    const second = child(harness, parent.id);
    finish(harness, parent.id, 'Waiting on the reviews.');
    expect(current(harness, parent.id)).toMatchObject({
      status: 'waiting',
      endedAt: null,
      waitingOn: { delegations: [first.id, second.id], reason },
    });
    expect(harness.task(taskId).stageReason).toBe('waiting for 2 delegations');
    expect(isTaskLive(harness.state, harness.task(taskId))).toBe(true);
    expect(harness.task(taskId).recoveries).toBe(0);
    finish(harness, first.id);
    expect(lastClaim(harness, parent.id)).toEqual({
      generation: 1,
      items: [`result:${first.id}`],
      via: 'wake',
    });
    expect(harness.lastEffect('run.wake')).toEqual({ kind: 'run.wake', runId: parent.id, generation: 1 });
    harness.send({
      type: 'delegation.record_delivery',
      runId: parent.id,
      generation: 1,
      items: [`result:${first.id}`],
    });
    expect(current(harness, parent.id)).toMatchObject({ status: 'running', waitingOn: null });
    expect(harness.task(taskId).stageReason).toBe(reason);
  });

  test('a parent with one task left waits for a single delegation', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    child(harness, parent.id);
    finish(harness, parent.id);
    expect(harness.task(taskId).stageReason).toBe('waiting for a delegation');
  });

  test('a parent that ends its turn with only undelivered results is woken with them at once', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    finish(harness, delegated.id);
    finish(harness, parent.id);
    expect(current(harness, parent.id)).toMatchObject({ status: 'waiting' });
    expect(lastClaim(harness, parent.id)?.via).toBe('steer');
    harness.send({ type: 'delegation.release', runId: parent.id, generation: 1, items: [] });
    expect(lastClaim(harness, parent.id)).toEqual({
      generation: 2,
      items: [`result:${delegated.id}`],
      via: 'wake',
    });
  });

  test('a provider that cannot take a report mid-turn gets it as soon as its turn ends', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const first = child(harness, parent.id);
    const second = child(harness, parent.id);
    finish(harness, first.id);
    harness.send({ type: 'delegation.release', runId: parent.id, generation: 1, items: [] });
    expect(current(harness, parent.id).cohort).toMatchObject({ claim: null, deferred: true });
    const steers = harness.effectsOf('delegation.steer').length;
    finish(harness, second.id);
    expect(harness.effectsOf('delegation.steer')).toHaveLength(steers);
    finish(harness, parent.id);
    expect(lastClaim(harness, parent.id)).toEqual({
      generation: 2,
      items: [`result:${first.id}`, `result:${second.id}`],
      via: 'wake',
    });
    expect(current(harness, parent.id).cohort?.deferred).toBe(false);
  });

  test('a steered report the agent never answered is delivered again', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    finish(harness, delegated.id);
    harness.send({
      type: 'delegation.record_delivery',
      runId: parent.id,
      generation: 1,
      items: [`result:${delegated.id}`],
    });
    harness.send({
      type: 'delegation.release',
      runId: parent.id,
      generation: null,
      items: [`result:${delegated.id}`],
    });
    expect(current(harness, delegated.id).delegation?.delivery).toBe('none');
    expect(lastClaim(harness, parent.id)).toEqual({
      generation: 2,
      items: [`result:${delegated.id}`],
      via: 'steer',
    });
  });

  test('a delivery for a run that has ended, or for an older generation, is ignored', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    finish(harness, delegated.id);
    expect(
      harness.send({ type: 'delegation.release', runId: parent.id, generation: 5, items: [] }).events
    ).toEqual([]);
    harness.send({
      type: 'delegation.record_delivery',
      runId: parent.id,
      generation: 1,
      items: [`result:${delegated.id}`],
    });
    completePhase(harness, taskId);
    expect(
      harness.send({ type: 'delegation.record_delivery', runId: parent.id, generation: 2, items: [] }).events
    ).toEqual([]);
    expect(
      harness.send({ type: 'delegation.release', runId: parent.id, generation: null, items: [] }).events
    ).toEqual([]);
    expect(
      harness.send({ type: 'delegation.record_delivery', runId: 'nope', generation: 1, items: [] }).events
    ).toEqual([]);
  });

  test('a blocking wait keeps the result for its tool call; a wait that times out switches to waking the parent', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const awaited = child(harness, parent.id, { mode: 'wait' });
    expect(awaited.delegation?.wake).toBe('settled_only');
    finish(harness, awaited.id);
    expect(lastClaim(harness, parent.id)).toBeNull();
    harness.send({ type: 'delegation.wake_policy', runId: awaited.id, wake: 'always' });
    expect(lastClaim(harness, parent.id)).toEqual({
      generation: 1,
      items: [`result:${awaited.id}`],
      via: 'steer',
    });
    expect(
      harness.send({ type: 'delegation.wake_policy', runId: awaited.id, wake: 'always' }).events
    ).toEqual([]);
    expect(harness.send({ type: 'delegation.wake_policy', runId: parent.id, wake: 'always' }).events).toEqual(
      []
    );
  });

  test('a wait whose result was returned by the tool is acknowledged and never delivered again', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const awaited = child(harness, parent.id, { mode: 'wait' });
    finish(harness, awaited.id);
    harness.send({ type: 'agent.acknowledge_delegation', runId: parent.id, childRunId: awaited.id });
    expect(current(harness, awaited.id).delegation?.delivery).toBe('acknowledged');
    finish(harness, parent.id);
    expect(current(harness, parent.id).endedAt).not.toBeNull();
    expect(harness.task(taskId).recoveries).toBe(1);
  });

  test('a parent waiting on a blocking wait that ends its turn gets the result when it comes', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const awaited = child(harness, parent.id, { mode: 'wait' });
    finish(harness, parent.id);
    finish(harness, awaited.id);
    expect(lastClaim(harness, parent.id)).toEqual({
      generation: 1,
      items: [`result:${awaited.id}`],
      via: 'wake',
    });
  });

  test('reading a result with delegation_status counts as receiving it; reading again changes nothing', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const running = child(harness, parent.id);
    expect(
      harness.send({ type: 'agent.acknowledge_delegation', runId: parent.id, childRunId: running.id }).events
    ).toEqual([]);
    finish(harness, running.id);
    harness.send({ type: 'agent.acknowledge_delegation', runId: parent.id, childRunId: running.id });
    expect(current(harness, running.id).delegation?.delivery).toBe('acknowledged');
    expect(
      harness.send({ type: 'agent.acknowledge_delegation', runId: parent.id, childRunId: running.id }).events
    ).toEqual([]);
  });

  test('a parent that read the result on its way to it has nothing to wait for when its turn ends', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    finish(harness, delegated.id);
    expect(lastClaim(harness, parent.id)?.via).toBe('steer');
    harness.send({ type: 'agent.acknowledge_delegation', runId: parent.id, childRunId: delegated.id });
    finish(harness, parent.id, 'Ending my turn.');
    expect(current(harness, parent.id)).toMatchObject({ status: 'running', outcome: 'completed' });
    expect(harness.activeRun(taskId).id).not.toBe(parent.id);
    expect(
      harness.send({ type: 'delegation.release', runId: parent.id, generation: 1, items: [] }).events
    ).toEqual([]);
  });

  test('a parent that stopped the task whose question was on its way has nothing to wait for either', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    harness.send({
      type: 'agent.ask',
      runId: delegated.id,
      gateId: 'q1',
      question: 'Which file?',
      context: null,
    });
    expect(lastClaim(harness, parent.id)?.items).toEqual([`question:${delegated.id}:q1`]);
    harness.send({ type: 'agent.cancel_delegation', runId: parent.id, childRunId: delegated.id });
    finish(harness, parent.id, 'Ending my turn.');
    expect(current(harness, parent.id).outcome).toBe('completed');
    expect(harness.activeRun(taskId).id).not.toBe(parent.id);
  });

  test('a failed delegation reports its error as its result', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const failing = child(harness, parent.id);
    harness.send({
      type: 'run.end',
      runId: failing.id,
      outcome: 'failed',
      summary: 'half a reply',
      failure: {
        class: 'overloaded',
        message: 'The API is overloaded.',
        code: null,
        retryable: true,
        resetAt: null,
      },
    });
    expect(current(harness, failing.id)).toMatchObject({
      outcome: 'failed',
      summary: 'The API is overloaded.',
    });
    expect(harness.task(taskId).recoveries).toBe(0);
    const silent = child(harness, parent.id);
    harness.send({ type: 'run.end', runId: silent.id, outcome: 'completed', summary: null });
    expect(current(harness, silent.id).summary).toBe('It ended without a reply.');
    const long = child(harness, parent.id);
    harness.send({ type: 'run.end', runId: long.id, outcome: 'completed', summary: 'x'.repeat(60_000) });
    expect(current(harness, long.id).summary?.length).toBe(DELEGATION_LIMITS.result + 1);
  });

  test('the human’s message to a waiting parent wakes it, after the reports', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    finish(harness, parent.id);
    harness.send({ type: 'task.message', taskId, text: 'Also check the button labels.' });
    const message = current(harness, parent.id).cohort?.messages[0];
    expect(message?.text).toBe('Also check the button labels.');
    expect(lastClaim(harness, parent.id)).toEqual({
      generation: 1,
      items: [`message:${message?.id}`],
      via: 'wake',
    });
    finish(harness, delegated.id);
    expect(lastClaim(harness, parent.id)?.items).toEqual([
      `message:${message?.id}`,
      `result:${delegated.id}`,
    ]);
    harness.send({
      type: 'delegation.record_delivery',
      runId: parent.id,
      generation: 1,
      items: [`message:${message?.id}`, `result:${delegated.id}`],
    });
    expect(current(harness, parent.id).cohort?.messages).toEqual([]);
  });

  test('a missed steer for a waiting parent waits for its next turn too', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    child(harness, parent.id);
    finish(harness, parent.id);
    harness.send({ type: 'message.deliver', taskId, text: 'Missed steer.' });
    expect(current(harness, parent.id).cohort?.messages.map((message) => message.text)).toEqual([
      'Missed steer.',
    ]);
  });
});

describe('questions from a delegated agent', () => {
  function ask(harness: Harness, runId: string, gateId = 'q-1') {
    return harness.send({
      type: 'agent.ask',
      runId,
      gateId,
      question: 'Should I include the legacy strings?',
      context: 'They are unused.',
      choices: ['Yes', 'No'],
      recommendation: 'No',
    });
  }

  test('go to the agent that delegated the task, never to the human, and its answer goes back', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    ask(harness, delegated.id);
    expect(listOpenGates(harness.state, taskId)).toEqual([]);
    expect(current(harness, delegated.id).delegation?.question).toMatchObject({
      id: 'q-1',
      question: 'Should I include the legacy strings?',
      choices: ['Yes', 'No'],
      recommendation: 'No',
      delivered: false,
      answer: null,
    });
    expect(lastClaim(harness, parent.id)?.items).toEqual([`question:${delegated.id}:q-1`]);
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      '“Check the copy” asked the agent that delegated it: Should I include the legacy strings?'
    );
    harness.send({
      type: 'delegation.record_delivery',
      runId: parent.id,
      generation: 1,
      items: [`question:${delegated.id}:q-1`],
    });
    expect(current(harness, delegated.id).delegation?.question?.delivered).toBe(true);
    harness.send({
      type: 'agent.answer_delegation',
      runId: parent.id,
      childRunId: delegated.id,
      answer: ' No. ',
    });
    expect(current(harness, delegated.id).delegation?.question).toMatchObject({ answer: 'No.' });
    expect(harness.lastEffect('delegation.reply')).toEqual({
      kind: 'delegation.reply',
      runId: delegated.id,
      questionId: 'q-1',
    });
  });

  test('one question at a time; asking the same one again changes nothing', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    ask(harness, delegated.id);
    expect(ask(harness, delegated.id).events).toEqual([]);
    expect(() => ask(harness, delegated.id, 'q-2')).toThrow(
      'Your earlier question is still waiting for an answer.'
    );
    harness.send({
      type: 'agent.answer_delegation',
      runId: parent.id,
      childRunId: delegated.id,
      answer: 'No.',
    });
    ask(harness, delegated.id, 'q-2');
    expect(current(harness, delegated.id).delegation?.question?.id).toBe('q-2');
  });

  test('an answer needs an open question and words in it', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    const answer = (text: string) =>
      harness.send({
        type: 'agent.answer_delegation',
        runId: parent.id,
        childRunId: delegated.id,
        answer: text,
      });
    expect(() => answer('Yes.')).toThrow('“Check the copy” has no question waiting for an answer.');
    ask(harness, delegated.id);
    expect(() => answer('   ')).toThrow('Write the answer first.');
  });

  test('a blocking wait holds the question for its tool call, which then counts as received', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const awaited = child(harness, parent.id, { mode: 'wait' });
    ask(harness, awaited.id);
    expect(lastClaim(harness, parent.id)).toBeNull();
    harness.send({ type: 'agent.acknowledge_delegation', runId: parent.id, childRunId: awaited.id });
    expect(current(harness, awaited.id).delegation?.question?.delivered).toBe(true);
    finish(harness, parent.id);
    expect(lastClaim(harness, parent.id)).toBeNull();
  });

  test('a question from an agent that stopped is never delivered', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    const question = `question:${delegated.id}:q-1`;
    ask(harness, delegated.id);
    harness.send({ type: 'delegation.record_delivery', runId: parent.id, generation: 1, items: [] });
    expect(lastClaim(harness, parent.id)).toEqual({ generation: 2, items: [question], via: 'steer' });
    harness.send({ type: 'delegation.cancel', runId: delegated.id });
    expect(lastClaim(harness, parent.id)?.items).toEqual([question, `result:${delegated.id}`]);
    harness.send({
      type: 'delegation.record_delivery',
      runId: parent.id,
      generation: 2,
      items: [`result:${delegated.id}`],
    });
    expect(lastClaim(harness, parent.id)).toBeNull();
  });

  test('a delegated agent waiting for its answer is neither interrupted nor continued after a restart', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    ask(harness, delegated.id);
    expect(harness.send({ type: 'run.interrupt', runId: delegated.id }).events).toEqual([]);
    expect(harness.send({ type: 'run.continue', runId: delegated.id }).events).toEqual([]);
  });
});

describe('the limits a delegation works within', () => {
  test('hand-overs wait for delegations: refused while one runs, allowed once it ends', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    expect(() => completePhase(harness, taskId)).toThrow(
      '1 delegation is still running. End your turn and their results wake you, or stop them with `delegation_cancel`, before you hand over.'
    );
    child(harness, parent.id);
    expect(() =>
      harness.send({
        type: 'agent.wait_for',
        runId: parent.id,
        checkInMinutes: 5,
        notes: 'The deploy.',
        timeoutMinutes: null,
        maxAttempts: null,
      })
    ).toThrow('2 delegations are still running.');
    for (const live of listChildRuns(harness.state, parent.id)) {
      harness.send({ type: 'agent.cancel_delegation', runId: parent.id, childRunId: live.id });
    }
    completePhase(harness, taskId);
    expect(current(harness, delegated.id).outcome).toBe('cancelled');
  });

  test('a delegated agent cannot hand over the step, suggest or create tasks', () => {
    const { harness, taskId } = building();
    const delegated = child(harness, harness.activeRun(taskId).id, { role: 'builder' });
    const refusal = 'Another agent delegated this work to you, so you have no hand-over tools.';
    expect(() =>
      harness.send({
        type: 'agent.complete_phase',
        runId: delegated.id,
        summary: 'x',
        spots: [],
        judgementCalls: [],
      })
    ).toThrow(refusal);
    expect(() =>
      harness.send({
        type: 'agent.suggest_tasks',
        runId: delegated.id,
        suggestions: [{ title: 'A', request: 'B', why: 'C', waitsOnThis: false }],
      })
    ).toThrow(refusal);
    expect(() =>
      harness.send({
        type: 'agent.create_task',
        runId: delegated.id,
        requestKey: 'k',
        request: 'Do it.',
        repoId: null,
        thisWaits: false,
      })
    ).toThrow(refusal);
    harness.send({ type: 'agent.note', runId: delegated.id, note: 'Noted from a delegated agent.' });
    expect(harness.task(taskId).note).toBe('Noted from a delegated agent.');
  });

  test('scope checks ignore a run that does not exist', () => {
    const { harness } = building();
    expect(() => harness.send({ type: 'agent.note', runId: 'nope', note: 'x' })).toThrow('No run nope');
  });

  test('unknown delegations are refused by name', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    const nested = child(harness, delegated.id);
    const refusal = `No task ${nested.id} was delegated by you.`;
    expect(() =>
      harness.send({ type: 'agent.cancel_delegation', runId: parent.id, childRunId: nested.id })
    ).toThrow(refusal);
    expect(() =>
      harness.send({ type: 'agent.cancel_delegation', runId: parent.id, childRunId: 'nope' })
    ).toThrow('No task nope was delegated by you.');
    expect(() =>
      harness.send({ type: 'agent.cancel_delegation', runId: parent.id, childRunId: parent.id })
    ).toThrow(`No task ${parent.id}`);
    expect(() => harness.send({ type: 'delegation.cancel', runId: parent.id })).toThrow(
      `No delegation ${parent.id}`
    );
    expect(() => harness.send({ type: 'delegation.cancel', runId: 'nope' })).toThrow('No delegation nope');
  });
});

describe('stopping delegated work', () => {
  test('the agent that delegated a task can stop it, with everything under it, and hears nothing back', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id, { role: 'builder' });
    const nested = child(harness, delegated.id);
    const decision = harness.send({
      type: 'agent.cancel_delegation',
      runId: parent.id,
      childRunId: delegated.id,
    });
    expect(current(harness, delegated.id)).toMatchObject({
      outcome: 'cancelled',
      summary: 'Stopped by the agent that delegated it.',
    });
    expect(current(harness, delegated.id).delegation?.delivery).toBe('acknowledged');
    expect(current(harness, nested.id)).toMatchObject({
      outcome: 'cancelled',
      summary: 'Stopped because the agent that delegated it finished its step.',
    });
    expect(decision.effects).toContainEqual({ kind: 'run.cancel', runId: delegated.id });
    expect(decision.effects).toContainEqual({ kind: 'run.cancel', runId: nested.id });
    expect(lastClaim(harness, parent.id)).toBeNull();
    expect(
      harness.send({ type: 'agent.cancel_delegation', runId: parent.id, childRunId: delegated.id }).events
    ).toEqual([]);
  });

  test('stopping it from the task page reports it to the agent that delegated it', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    harness.send({ type: 'delegation.cancel', runId: delegated.id });
    expect(current(harness, delegated.id)).toMatchObject({
      outcome: 'cancelled',
      summary: 'Stopped by you.',
    });
    expect(lastClaim(harness, parent.id)?.items).toEqual([`result:${delegated.id}`]);
    expect(harness.send({ type: 'delegation.cancel', runId: delegated.id }).events).toEqual([]);
  });

  test('when the task is cancelled every delegation under its step stops, at any depth', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id, { role: 'builder' });
    const nested = child(harness, delegated.id, { role: 'builder' });
    const decision = harness.send({ type: 'task.cancel', taskId });
    for (const id of [parent.id, delegated.id, nested.id]) {
      expect(current(harness, id).outcome).toBe('cancelled');
      expect(decision.effects).toContainEqual({ kind: 'run.cancel', runId: id });
    }
    expect(listLiveRuns(harness.state, taskId)).toEqual([]);
  });

  test('a delegation that never started is stopped without a cancel for a process', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: 1 } });
    harness.send({
      type: 'run.meter',
      runId: parent.id,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 2 },
    });
    const decision = harness.send({
      type: 'agent.delegate',
      runId: parent.id,
      requestKey: 'over-budget',
      title: 'Check',
      brief: 'Check it.',
      role: 'reviewer',
      mode: 'async',
      isolation: 'shared',
      baseCommit: null,
      provider: null,
      model: null,
    });
    const started = decision.events.find((event) => event.type === 'run.started');
    const childId = started?.type === 'run.started' ? started.run.id : '';
    expect(current(harness, childId).outcome).toBe('cancelled');
    expect(decision.effects).not.toContainEqual({ kind: 'run.cancel', runId: childId });
    expect(listOpenGates(harness.state, taskId).map((gate) => gate.cause)).toEqual(['budget']);
  });

  test('a delegation that finishes after its parent’s step ended changes nothing', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    harness.send({ type: 'task.cancel', taskId });
    expect(finish(harness, delegated.id).events).toEqual([]);
  });
});

describe('restarts and recovery', () => {
  test('a parent that fails and is restarted adopts what it delegated, finished results included, which then report to the new run', () => {
    const { harness, taskId } = building();
    linkSession(harness, taskId);
    const parent = harness.activeRun(taskId);
    const awaited = child(harness, parent.id, { mode: 'wait', title: 'Run the slow suite' });
    const done = child(harness, parent.id);
    finish(harness, done.id);
    harness.send({
      type: 'run.end',
      runId: parent.id,
      outcome: 'failed',
      summary: 'crashed',
      failure: {
        class: 'provider_error',
        message: 'The API failed.',
        code: null,
        retryable: null,
        resetAt: null,
      },
    });
    const successor = harness.activeRun(taskId);
    expect(successor.id).not.toBe(parent.id);
    expect(current(harness, parent.id).outcome).toBe('failed');
    expect(current(harness, awaited.id).delegation).toMatchObject({
      parentRunId: successor.id,
      wake: 'always',
    });
    expect(current(harness, awaited.id).endedAt).toBeNull();
    expect(successor.prompt).toContain(`- "Run the slow suite" (delegation id ${awaited.id})`);
    expect(successor.prompt).not.toContain(done.id);
    expect(current(harness, done.id).delegation?.parentRunId).toBe(successor.id);
    expect(lastClaim(harness, successor.id)?.items).toEqual([`result:${done.id}`]);
    finish(harness, awaited.id);
    expect(lastClaim(harness, successor.id)?.items).toEqual([`result:${done.id}`, `result:${awaited.id}`]);
  });

  test('an adopted task’s open question reaches the new run as soon as it starts', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const asking = child(harness, parent.id);
    harness.send({
      type: 'agent.ask',
      runId: asking.id,
      gateId: 'q-1',
      question: 'Which one?',
      context: null,
    });
    harness.send({ type: 'delegation.release', runId: parent.id, generation: 1, items: [] });
    harness.send({ type: 'run.end', runId: parent.id, outcome: 'failed', summary: 'crashed' });
    const successor = harness.activeRun(taskId);
    expect(lastClaim(harness, successor.id)).toEqual({
      generation: 1,
      items: [`question:${asking.id}:q-1`],
      via: 'steer',
    });
  });

  test('a parent that is paused instead of restarted stops what it delegated', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    harness.send({
      type: 'run.end',
      runId: parent.id,
      outcome: 'failed',
      summary: 'no account',
      failure: {
        class: 'setup_failed',
        message: 'It could not start.',
        code: null,
        retryable: null,
        resetAt: null,
      },
    });
    expect(current(harness, delegated.id).outcome).toBe('cancelled');
    expect(listOpenGates(harness.state, taskId).map((gate) => gate.type)).toEqual(['failure']);
  });

  for (const failure of ['usage_limit', 'auth'] as const) {
    test(`a delegated agent stopped by ${failure} reports to the agent that delegated it and leaves the task as it was`, () => {
      const { harness, taskId } = building();
      const parent = harness.activeRun(taskId);
      const delegated = child(harness, parent.id);
      const reason = harness.task(taskId).stageReason;
      harness.send({
        type: 'run.end',
        runId: delegated.id,
        outcome: 'failed',
        summary: 'Out of usage.',
        failure: {
          class: failure,
          message: 'Out of usage.',
          code: null,
          retryable: true,
          resetAt: harness.now + 60_000,
          account: { id: 'acc', email: 'a@example.com' },
        },
      });
      expect(harness.task(taskId).usageWait ?? null).toBeNull();
      expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
      expect(harness.task(taskId).stageReason).toBe(reason);
      expect(harness.activeRun(taskId).id).toBe(parent.id);
      expect(current(harness, delegated.id).outcome).toBe('failed');
    });
  }

  test('a step that waits for the usage limit stops what it delegated, and the resumed step starts without it', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    harness.send({
      type: 'run.end',
      runId: parent.id,
      outcome: 'failed',
      summary: 'Limit.',
      failure: {
        class: 'usage_limit',
        message: 'Limit.',
        code: null,
        retryable: true,
        resetAt: harness.now + 60_000,
        account: null,
      },
    });
    expect(harness.task(taskId).usageWait?.status).toBe('armed');
    expect(current(harness, delegated.id).outcome).toBe('cancelled');
    harness.send({ type: 'usage_wait.resume_now', taskId });
    const resumed = harness.activeRun(taskId);
    expect(current(harness, delegated.id).delegation?.parentRunId).toBe(parent.id);
    expect(resumed.prompt).not.toContain(delegated.id);
  });

  test('a step that is restarted keeps what it delegated; a failure gate stops it', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    harness.send({ type: 'message.deliver', taskId, text: 'Restart the phase.' });
    const successor = harness.activeRun(taskId);
    expect(successor.id).not.toBe(parent.id);
    expect(current(harness, delegated.id).delegation?.parentRunId).toBe(successor.id);
    harness.send({ type: 'effect.fail', taskId, title: 'Could not push', detail: 'x' });
    expect(current(harness, delegated.id).outcome).toBe('cancelled');
  });

  test('a restart re-offers every delivery that had not reached its agent, under a new generation', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const delegated = child(harness, parent.id);
    const awaited = child(harness, parent.id, { mode: 'wait' });
    finish(harness, delegated.id);
    expect(lastClaim(harness, parent.id)?.generation).toBe(1);
    harness.send({ type: 'delegations.recover' });
    expect(lastClaim(harness, parent.id)).toEqual({
      generation: 2,
      items: [`result:${delegated.id}`],
      via: 'steer',
    });
    expect(current(harness, awaited.id).delegation?.wake).toBe('always');
    expect(harness.send({ type: 'delegations.recover' }).events.map((event) => event.type)).toEqual([
      'delegation.released',
      'delegation.claimed',
    ]);
  });

  test('a continued run’s blocking waits switch to waking it, since the tool call died with the process', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const awaited = child(harness, parent.id, { mode: 'wait' });
    harness.send({ type: 'run.interrupt', runId: parent.id });
    harness.send({ type: 'run.continue', runId: parent.id });
    expect(current(harness, awaited.id).delegation?.wake).toBe('always');
  });

  test('a result a blocking wait never returned is delivered to the continued run', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    const awaited = child(harness, parent.id, { mode: 'wait' });
    finish(harness, awaited.id);
    harness.send({ type: 'run.interrupt', runId: parent.id });
    harness.send({ type: 'run.continue', runId: parent.id });
    expect(lastClaim(harness, parent.id)).toEqual({
      generation: 1,
      items: [`result:${awaited.id}`],
      via: 'steer',
    });
  });

  test('a run waiting on its delegations is neither interrupted nor continued: their results wake it', () => {
    const { harness, taskId } = building();
    const parent = harness.activeRun(taskId);
    child(harness, parent.id);
    finish(harness, parent.id);
    expect(harness.send({ type: 'run.interrupt', runId: parent.id }).events).toEqual([]);
    expect(harness.send({ type: 'run.continue', runId: parent.id }).events).toEqual([]);
  });
});
