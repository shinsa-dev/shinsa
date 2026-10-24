import { RUN_AGENT_ROLE, resolveAgentModel, resolveAgentProvider } from '../agent-models/index.ts';
import type { CommandOf, ShinsaCommand } from '../commands/index.ts';
import {
  DELEGATE_ROLES,
  DELEGATION_LIMITS,
  DomainError,
  isAgentQuestion,
  isDelegatedRun,
  isReadOnlyRole,
  type Run,
  type RunFailure,
  type RunOutcome,
} from '../domain/index.ts';
import { resolveDelegatePrompt } from '../prompts/orchestration.ts';
import {
  countLiveUnderRoot,
  type DelegatedRun,
  describeDelegateRole,
  listChildRuns,
  listLiveChildRuns,
  listPendingItems,
  resolveCohort,
  selectRootRun,
} from '../state/delegations.ts';
import { listLiveRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { findCurrentRun } from './runs.ts';

const HAND_OVER_COMMANDS: ReadonlySet<ShinsaCommand['type']> = new Set<ShinsaCommand['type']>([
  'agent.propose_plan',
  'agent.complete_phase',
  'agent.complete_fix',
  'agent.report_review',
  'agent.answer',
  'agent.wait_for',
]);

const STEP_ONLY_COMMANDS: ReadonlySet<ShinsaCommand['type']> = new Set<ShinsaCommand['type']>([
  ...HAND_OVER_COMMANDS,
  'agent.suggest_tasks',
  'agent.create_task',
  'agent.split_task',
]);

const EMPTY_RESULT = 'It ended without a reply.';

function withArticle(name: string) {
  return `${/^[aeiou]/.test(name) ? 'An' : 'A'} ${name}`;
}

function describeTasks(count: number) {
  return count === 1 ? '1 task you delegated is' : `${count} tasks you delegated are`;
}

function describeWaiting(count: number) {
  return `waiting for ${count === 1 ? 'a delegated task' : `${count} delegated tasks`}`;
}

export function assertDelegationScope(decider: Decider, command: ShinsaCommand & { runId: string }) {
  const run = decider.state.runs[command.runId];
  if (!run) return;
  if (isDelegatedRun(run) && STEP_ONLY_COMMANDS.has(command.type)) {
    throw new DomainError(
      'delegated_run',
      'Another agent delegated this work to you, so you have no hand-over tools. Put your result in your final reply and end your turn.'
    );
  }
  if (!HAND_OVER_COMMANDS.has(command.type)) return;
  const live = listLiveChildRuns(decider.state, run.id).length;
  if (live === 0) return;
  throw new DomainError(
    'delegations_running',
    `${describeTasks(live)} still running. End your turn and their results wake you, or stop them with \`delegation_cancel\`, before you hand over.`
  );
}

function selectRequested(decider: Decider, parent: Run, requestKey: string) {
  return (
    listChildRuns(decider.state, parent.id).find((child) => child.delegation.requestKey === requestKey) ??
    null
  );
}

function findChild(decider: Decider, parent: Run, childRunId: string): DelegatedRun {
  const child = decider.state.runs[childRunId];
  if (!child || !isDelegatedRun(child) || child.delegation.parentRunId !== parent.id) {
    throw new DomainError(
      'delegation_not_found',
      `No task ${childRunId} was delegated by you. Use the task_id that \`delegate_task\` returned.`
    );
  }
  return child;
}

function assertDelegationRoom(decider: Decider, parent: Run) {
  const root = selectRootRun(decider.state, parent) ?? parent;
  const live = countLiveUnderRoot(decider.state, root.id);
  if (live >= DELEGATION_LIMITS.live) {
    throw new DomainError(
      'delegation_limit',
      `${live} delegated tasks under this step are still running, which is the limit. End your turn, and the next one to finish wakes you and frees a place, or stop one with \`delegation_cancel\`.`
    );
  }
}

export function requestDelegation(decider: Decider, command: CommandOf<'agent.delegate'>) {
  const { run: parent, task } = findCurrentRun(decider, command.runId, 'delegate_task');
  if (selectRequested(decider, parent, command.requestKey)) return;
  if (!DELEGATE_ROLES.includes(command.role)) {
    throw new DomainError('delegation_role', `Delegate to one of: ${DELEGATE_ROLES.join(', ')}.`);
  }
  assertDelegationRoom(decider, parent);
  const depth = (parent.delegation?.depth ?? 0) + 1;
  if (isReadOnlyRole(parent.role) && !isReadOnlyRole(command.role)) {
    throw new DomainError(
      'delegation_ceiling',
      `${withArticle(describeDelegateRole(parent.role))} cannot change files, so the agents it delegates to cannot either. Delegate to a planner or a reviewer.`
    );
  }
  if (command.isolation === 'worktree' && (!task.worktreePath || !command.baseCommit)) {
    throw new DomainError(
      'isolation_unavailable',
      'This task has no commit to copy into a separate checkout. Leave isolation unset to work in the same checkout.'
    );
  }
  const settings = decider.state.settings;
  const role = RUN_AGENT_ROLE[command.role];
  const provider = command.provider ?? resolveAgentProvider(settings, role);
  const brief = command.brief.trim();
  const run: Run = {
    id: decider.context.newId(),
    taskId: task.id,
    role: command.role,
    status: 'queued',
    phaseIndex: null,
    prompt: resolveDelegatePrompt({
      task,
      repo: decider.repoOf(task),
      role: command.role,
      brief,
      isolation: command.isolation,
      depth,
    }),
    resume: false,
    provider,
    model: command.model ?? resolveAgentModel(settings, role, provider),
    sessionId: null,
    startedAt: decider.context.now,
    endedAt: null,
    outcome: null,
    summary: null,
    delegation: {
      parentRunId: parent.id,
      depth,
      requestKey: command.requestKey,
      title: command.title.trim(),
      brief,
      mode: command.mode,
      wake: command.mode === 'wait' ? 'settled_only' : 'always',
      isolation: command.isolation,
      baseCommit: command.isolation === 'worktree' ? command.baseCommit : null,
      delivery: 'none',
      question: null,
      requestedAt: decider.context.now,
    },
    ...(parent.account ? { account: parent.account } : {}),
    ...(parent.round ? { round: parent.round } : {}),
  };
  decider.emit({ type: 'run.started', run });
}

export function cancelDelegation(decider: Decider, command: CommandOf<'agent.cancel_delegation'>) {
  const { run: parent } = findCurrentRun(decider, command.runId, 'delegation_cancel');
  const child = findChild(decider, parent, command.childRunId);
  if (child.endedAt !== null) return;
  decider.stopRun(child, 'Stopped by the agent that delegated it.');
  decider.emit({ type: 'delegation.acknowledged', runId: child.id });
}

export function cancelDelegationByUser(decider: Decider, command: CommandOf<'delegation.cancel'>) {
  const run = decider.state.runs[command.runId];
  if (!run || !isDelegatedRun(run)) {
    throw new DomainError('delegation_not_found', `No delegated task ${command.runId}`);
  }
  if (run.endedAt !== null) return;
  decider.stopRun(run, 'Stopped by you.');
  planDelivery(decider, run.delegation.parentRunId);
}

export function answerDelegation(decider: Decider, command: CommandOf<'agent.answer_delegation'>) {
  const { run: parent } = findCurrentRun(decider, command.runId, 'delegation_answer');
  const child = findChild(decider, parent, command.childRunId);
  const question = child.delegation.question;
  if (child.endedAt !== null || !question || question.answer !== null) {
    throw new DomainError(
      'no_question',
      `“${child.delegation.title}” has no question waiting for an answer.`
    );
  }
  const answer = command.answer.trim();
  if (answer.length === 0) throw new DomainError('answer_required', 'Write the answer first.');
  decider.emit({ type: 'delegation.answered', runId: child.id, questionId: question.id, answer });
  decider.run({ kind: 'delegation.reply', runId: child.id, questionId: question.id });
}

export function acknowledgeDelegation(decider: Decider, command: CommandOf<'agent.acknowledge_delegation'>) {
  const { run: parent } = findCurrentRun(decider, command.runId, 'delegation_status');
  const child = findChild(decider, parent, command.childRunId);
  const question = child.delegation.question;
  const unread = child.endedAt !== null && child.delegation.delivery === 'none';
  const unseen =
    child.endedAt === null && question !== null && question.answer === null && !question.delivered;
  if (!unread && !unseen) return;
  decider.emit({ type: 'delegation.acknowledged', runId: child.id });
}

export function routeQuestion(
  decider: Decider,
  command: CommandOf<'agent.ask'>,
  askHuman: (decider: Decider, command: CommandOf<'agent.ask'>) => void
) {
  const asker = decider.state.runs[command.runId];
  if (!asker || !isDelegatedRun(asker)) {
    askHuman(decider, command);
    return;
  }
  findCurrentRun(decider, asker.id, 'ask');
  const current = asker.delegation.question;
  if (current?.id === command.gateId) return;
  if (current && current.answer === null) {
    throw new DomainError(
      'question_open',
      'Your earlier question is still waiting for an answer. Wait for it before you ask another.'
    );
  }
  decider.emit({
    type: 'delegation.asked',
    runId: asker.id,
    question: {
      id: command.gateId,
      question: command.question,
      context: command.context,
      choices: command.choices ?? [],
      recommendation: command.recommendation ?? null,
      askedAt: decider.context.now,
      delivered: false,
      answer: null,
      answeredAt: null,
    },
  });
  planDelivery(decider, asker.delegation.parentRunId);
}

export function changeWakePolicy(decider: Decider, command: CommandOf<'delegation.wake_policy'>) {
  const run = decider.state.runs[command.runId];
  if (!run || !isDelegatedRun(run) || run.delegation.wake === command.wake) return;
  decider.emit({ type: 'delegation.wake_changed', runId: run.id, wake: command.wake });
  planDelivery(decider, run.delegation.parentRunId);
}

export function recordDelivered(decider: Decider, command: CommandOf<'delegation.delivered'>) {
  const parent = decider.state.runs[command.runId];
  const claim = parent ? resolveCohort(parent).claim : null;
  if (!parent || parent.endedAt !== null || !claim || claim.generation !== command.generation) return;
  const items = command.items.filter((item) => claim.items.includes(item));
  decider.emit({
    type: 'delegation.delivered',
    runId: parent.id,
    generation: claim.generation,
    items,
    via: claim.via,
  });
  if (claim.via === 'wake' && parent.waitingOn && !isDelegatedRun(parent)) {
    const task = decider.task(parent.taskId);
    decider.stage(task.id, task.stage, parent.waitingOn.reason);
  }
  planDelivery(decider, parent.id);
}

export function recordUndelivered(decider: Decider, command: CommandOf<'delegation.undelivered'>) {
  const parent = decider.state.runs[command.runId];
  if (!parent || parent.endedAt !== null) return;
  if (command.generation === null) {
    decider.emit({
      type: 'delegation.released',
      runId: parent.id,
      generation: null,
      items: command.items,
      deferred: false,
    });
    planDelivery(decider, parent.id);
    return;
  }
  const claim = resolveCohort(parent).claim;
  if (claim?.generation !== command.generation) return;
  decider.emit({
    type: 'delegation.released',
    runId: parent.id,
    generation: claim.generation,
    items: claim.items,
    deferred: parent.status === 'running',
  });
  planDelivery(decider, parent.id);
}

export function recoverDeliveries(decider: Decider) {
  const live = listLiveRuns(decider.state);
  for (const run of live) {
    const claim = resolveCohort(run).claim;
    if (claim) {
      decider.emit({
        type: 'delegation.released',
        runId: run.id,
        generation: claim.generation,
        items: claim.items,
        deferred: false,
      });
    }
    releaseWaits(decider, run.id);
  }
}

export function releaseWaits(decider: Decider, runId: string) {
  for (const child of listChildRuns(decider.state, runId)) {
    if (child.delegation.wake === 'always') continue;
    decider.emit({ type: 'delegation.wake_changed', runId: child.id, wake: 'always' });
  }
  planDelivery(decider, runId);
}

export function queueMessageForWake(decider: Decider, run: Run, text: string) {
  decider.emit({
    type: 'delegation.message_queued',
    runId: run.id,
    message: { id: decider.context.newId(), text },
  });
  planDelivery(decider, run.id);
}

export function waitForDelegations(decider: Decider, run: Run) {
  const task = decider.task(run.taskId);
  const live = listLiveChildRuns(decider.state, run.id);
  decider.emit({
    type: 'run.waiting',
    runId: run.id,
    wait: {
      delegations: live.map((child) => child.id),
      since: decider.context.now,
      reason: task.stageReason,
    },
  });
  decider.withdrawGates(task.id, (gate) => isAgentQuestion(gate) && gate.runId === run.id);
  if (live.length > 0 && !isDelegatedRun(run))
    decider.stage(task.id, task.stage, describeWaiting(live.length));
  planDelivery(decider, run.id);
}

function resolveResult(outcome: RunOutcome, summary: string | null, failure: RunFailure | null) {
  const text = outcome === 'failed' ? (failure?.message ?? summary) : summary;
  const trimmed = text?.trim() ?? '';
  if (trimmed.length === 0) return EMPTY_RESULT;
  return trimmed.length > DELEGATION_LIMITS.result
    ? `${trimmed.slice(0, DELEGATION_LIMITS.result)}…`
    : trimmed;
}

export function settleDelegation(
  decider: Decider,
  run: DelegatedRun,
  outcome: RunOutcome,
  summary: string | null,
  failure: RunFailure | null
) {
  decider.endRun(run, outcome, resolveResult(outcome, summary, failure), failure);
  planDelivery(decider, run.delegation.parentRunId);
}

export function planDelivery(decider: Decider, runId: string) {
  const parent = decider.state.runs[runId];
  if (!parent || parent.endedAt !== null || parent.status === 'queued') return;
  const cohort = resolveCohort(parent);
  const pending = listPendingItems(decider.state, parent);
  if (cohort.claim) {
    if (pending.length === 0) return;
    decider.emit({
      type: 'delegation.claimed',
      runId: parent.id,
      claim: { ...cohort.claim, items: [...cohort.claim.items, ...pending] },
    });
    return;
  }
  const waiting = parent.status === 'waiting';
  if (pending.length === 0) return;
  if (!waiting && cohort.deferred) return;
  const generation = cohort.nextGeneration;
  const via = waiting ? 'wake' : 'steer';
  decider.emit({ type: 'delegation.claimed', runId: parent.id, claim: { generation, items: pending, via } });
  decider.run(
    via === 'wake'
      ? { kind: 'run.wake', runId: parent.id, generation }
      : { kind: 'delegation.steer', runId: parent.id, generation }
  );
}
