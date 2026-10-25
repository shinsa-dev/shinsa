import { expect } from 'bun:test';
import {
  DELEGATE_ROLES,
  DELEGATION_LIMITS,
  isDelegatedRun,
  isReadOnlyRole,
  isTaskSettled,
  listChildRuns,
  listLiveChildRuns,
  listLiveRuns,
  listOpenGates,
  parseDeliveryItem,
  type Run,
  resolveCohort,
  type ShinsaCommand,
  type ShinsaState,
  selectRootRun,
  type Task,
} from '../../src/index.ts';
import { listPendingItems } from '../../src/state/delegations.ts';

type Random = () => number;

function pick<T>(random: Random, items: readonly T[]): T | undefined {
  return items[Math.floor(random() * items.length)];
}

function chance(random: Random, odds: number) {
  return random() < odds;
}

const KEYS = ['k1', 'k2', 'k3', 'k4'];

function listParentCommands(state: ShinsaState, run: Run, random: Random): ShinsaCommand[] {
  const runId = run.id;
  const commands: ShinsaCommand[] = [
    {
      type: 'agent.delegate',
      runId,
      requestKey: `${pick(random, KEYS) ?? 'k1'}-${state.seq % 5}`,
      title: 'Look into it',
      brief: 'Look into it and report.',
      role: pick(random, DELEGATE_ROLES) ?? 'planner',
      mode: chance(random, 0.4) ? 'wait' : 'async',
      isolation: chance(random, 0.2) ? 'worktree' : 'shared',
      baseCommit: chance(random, 0.8) ? 'abc123' : null,
      provider: null,
      model: null,
    },
  ];
  for (const child of listChildRuns(state, runId)) {
    const answer: ShinsaCommand = {
      type: 'agent.answer_delegation',
      runId,
      childRunId: child.id,
      answer: 'Go ahead.',
    };
    commands.push(
      { type: 'agent.cancel_delegation', runId, childRunId: child.id },
      { type: 'agent.acknowledge_delegation', runId, childRunId: child.id },
      answer
    );
    if (child.delegation.question?.answer === null) commands.push(answer, answer, answer);
  }
  const claim = resolveCohort(run).claim;
  if (claim) {
    const items = claim.items.filter(() => chance(random, 0.7));
    commands.push(
      { type: 'delegation.record_delivery', runId, generation: claim.generation, items },
      { type: 'delegation.record_delivery', runId, generation: claim.generation, items: claim.items },
      { type: 'delegation.record_delivery', runId, generation: claim.generation - 1, items },
      { type: 'delegation.release', runId, generation: claim.generation, items: [] }
    );
  }
  const delivered = listChildRuns(state, runId)
    .filter((child) => child.delegation.delivery === 'delivered')
    .map((child) => `result:${child.id}`);
  if (delivered.length > 0)
    commands.push({ type: 'delegation.release', runId, generation: null, items: delivered });
  return commands;
}

function listChildCommands(
  state: ShinsaState,
  run: Run & { delegation: object },
  random: Random
): ShinsaCommand[] {
  const runId = run.id;
  return [
    {
      type: 'run.end',
      runId,
      outcome: pick(random, ['completed', 'completed', 'failed', 'cancelled']) ?? 'completed',
      summary: 'Here is what I found.',
    },
    { type: 'agent.ask', runId, gateId: `dq-${state.seq}`, question: 'Which one?', context: null },
    { type: 'agent.complete_phase', runId, summary: 'x', spots: [], judgementCalls: [] },
    { type: 'delegation.wake_policy', runId, wake: 'always' },
    { type: 'delegation.cancel', runId },
  ];
}

function listTaskCommands(task: Task, run: Run, random: Random): ShinsaCommand[] {
  return [
    {
      type: 'agent.create_task',
      runId: run.id,
      requestKey: `c-${pick(random, KEYS)}`,
      request: 'Carry the same change to the admin app.',
      repoId: null,
      thisWaits: chance(random, 0.3),
    },
    {
      type: 'agent.split_task',
      runId: run.id,
      requests: ['Port the header.'],
      thisWaits: chance(random, 0.3),
    },
    { type: 'task.message', taskId: task.id, text: 'And this.' },
  ];
}

export function listDelegationCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const commands: ShinsaCommand[] = [{ type: 'delegations.recover' }];
  for (const run of listLiveRuns(state)) {
    if (run.status === 'queued') continue;
    if (run.status !== 'waiting') commands.push(...listParentCommands(state, run, random));
    if (isDelegatedRun(run)) commands.push(...listChildCommands(state, run, random));
    const task = state.tasks[run.taskId];
    if (task && !isDelegatedRun(run)) commands.push(...listTaskCommands(task, run, random));
    if (run.status !== 'waiting' && chance(random, 0.5)) {
      commands.push({ type: 'run.end', runId: run.id, outcome: 'completed', summary: 'Ending my turn.' });
    }
  }
  return commands;
}

function assertItem(state: ShinsaState, parent: Run, raw: string, context: string) {
  const item = parseDeliveryItem(raw);
  expect(item, `${context}: unreadable item ${raw}`).not.toBeNull();
  if (item?.kind === 'message') {
    expect(
      resolveCohort(parent).messages.some((message) => message.id === item.messageId),
      context
    ).toBe(true);
    return;
  }
  const child = item ? state.runs[item.runId] : undefined;
  expect(child && isDelegatedRun(child) && child.delegation.parentRunId === parent.id, context).toBe(true);
}

function assertParent(state: ShinsaState, run: Run, context: string) {
  const cohort = resolveCohort(run);
  const claim = cohort.claim;
  if (claim) {
    expect(claim.generation, context).toBeLessThan(cohort.nextGeneration);
    for (const item of claim.items) assertItem(state, run, item, context);
  }
  const pending = listPendingItems(state, run).length;
  if (run.status === 'waiting') {
    const moving = claim !== null || (listLiveChildRuns(state, run.id).length > 0 && pending === 0);
    expect(moving, `${context}: run ${run.id} waits with nothing on its way to it`).toBe(true);
  } else {
    expect(
      pending === 0 || claim !== null || cohort.deferred,
      `${context}: undelivered report for ${run.id}`
    ).toBe(true);
  }
}

function assertChild(
  state: ShinsaState,
  run: Run & { delegation: NonNullable<Run['delegation']> },
  context: string
) {
  const parent = state.runs[run.delegation.parentRunId];
  expect(parent?.endedAt, `${context}: delegated run ${run.id} outlived its parent`).toBeNull();
  expect(parent?.taskId, context).toBe(run.taskId);
  expect(run.delegation.depth, context).toBe((parent?.delegation?.depth ?? 0) + 1);
  expect(run.delegation.depth, context).toBeLessThanOrEqual(DELEGATION_LIMITS.depth);
  if (parent && isReadOnlyRole(parent.role))
    expect(isReadOnlyRole(run.role), `${context}: ceiling`).toBe(true);
  expect(selectRootRun(state, run), context).not.toBeNull();
}

export function assertDelegationInvariants(state: ShinsaState, task: Task, context: string) {
  const live = listLiveRuns(state, task.id);
  if (isTaskSettled(task) || task.monitor?.status === 'armed') expect(live, context).toHaveLength(0);
  for (const run of live) {
    expect(run.status === 'running' || run.status === 'waiting', context).toBe(true);
    assertParent(state, run, context);
    if (isDelegatedRun(run)) assertChild(state, run, context);
  }
  for (const gate of listOpenGates(state, task.id)) {
    const asker = gate.runId ? state.runs[gate.runId] : undefined;
    expect(
      asker !== undefined && isDelegatedRun(asker),
      `${context}: a delegated agent reached the human`
    ).toBe(false);
  }
}

export function assertDelegationProgress(before: ShinsaState, after: ShinsaState, context: string) {
  for (const run of Object.values(after.runs)) {
    const prior = before.runs[run.id];
    if (!prior) continue;
    expect(resolveCohort(run).nextGeneration, `${context}: generation went back`).toBeGreaterThanOrEqual(
      resolveCohort(prior).nextGeneration
    );
  }
  for (const task of Object.values(after.tasks)) {
    const versions = (task.splits ?? []).map((split) => split.planVersion);
    expect(new Set(versions).size, `${context}: a plan version split twice`).toBe(versions.length);
  }
}

export function listDelegationMarks(state: ShinsaState) {
  return Object.values(state.runs).flatMap((run) => [
    run.status === 'waiting' ? 'waiting parent' : null,
    (run.delegation?.depth ?? 0) > 1 ? 'nested delegation' : null,
    run.delegation?.question?.answer ? 'answered delegation' : null,
    run.delegation?.delivery === 'delivered' ? 'delivered result' : null,
    (resolveCohort(run).nextGeneration ?? 1) > 2 ? 'later delivery generation' : null,
  ]);
}

export function listCreatedTaskMarks(state: ShinsaState) {
  return Object.values(state.tasks).flatMap((task) => [
    task.createdBy?.kind === 'courier' ? 'courier task' : null,
    (task.splits?.length ?? 0) > 0 ? 'split plan' : null,
  ]);
}
