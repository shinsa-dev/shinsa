import { RUN_AGENT_ROLE } from '../agent-models/index.ts';
import type { CommandOf } from '../commands/index.ts';
import {
  DELEGATION_LIMITS,
  DomainError,
  hasTool,
  isDelegatedRun,
  isHandOverTool,
  isTaskSessionRole,
  isTaskSettled,
  listToolNames,
  MINUTE_MS,
  PURPOSE_HAND_OVERS,
  RUN_STAGES,
  type Run,
  type RunFailure,
  type RunFailureClass,
  type RunOutcome,
  type RunPurpose,
  type RunRole,
  type ShinsaToolName,
  type Task,
} from '../domain/index.ts';
import { resolveFreshSessionNudge, resolveRecoveryNudge } from '../prompts/session.ts';
import { hasOutstandingDelegations, listLiveChildRuns } from '../state/delegations.ts';
import { findRun, isWaitingOnAnswer, listLiveRuns } from '../state/queries.ts';
import { requestSignIn, waitForUsageReset } from './accounts.ts';
import { holdForBudget } from './costs.ts';
import type { Decider } from './decider.ts';
import { planDelivery, releaseWaits, settleDelegation, waitForDelegations } from './delegations.ts';
import { resolveRecoveryFingerprint } from './fingerprints.ts';

const MAX_RECOVERIES = 1;

const MAX_CONTINUATIONS = 3;

const CONTINUATION_WINDOW_MS = 5 * MINUTE_MS;

type FailureRecovery = { mode: 'resume' } | { mode: 'fresh' } | { mode: 'pause'; title: string };

const RESUME: FailureRecovery = { mode: 'resume' };

const FRESH: FailureRecovery = { mode: 'fresh' };

const FAILURE_RECOVERY: Record<RunFailureClass, FailureRecovery> = {
  usage_limit: { mode: 'pause', title: 'The agent hit its usage limit' },
  auth: { mode: 'pause', title: 'The agent needs you to sign in' },
  setup_failed: { mode: 'pause', title: 'The agent could not start' },
  context_window_full: FRESH,
  image_error: FRESH,
  session_lost: FRESH,
  overloaded: RESUME,
  provider_error: RESUME,
  transport_error: RESUME,
  aborted: RESUME,
  budget_exhausted: RESUME,
  malformed_tool_use: RESUME,
  model_error: RESUME,
};

const PURPOSE_REFUSAL: Record<RunPurpose, string> = {
  plan: 'You are planning this round: hand the plan over with `propose_plan`, or compose the steps with `reshape_task`.',
  build: 'You are building a phase: hand it over with `complete_phase`.',
  fix: 'You are fixing the work: hand the fix over with `complete_fix`.',
  operate: 'You are running the operation: report how it went with `report_outcome`.',
  watch: 'You are checking a watchdog: report what you found with `report_watch`.',
};

const ROLE_REFUSAL: Partial<Record<RunRole, string>> = {
  answerer: 'You are answering: hand the answer over with `answer`.',
  investigator: 'You are investigating: hand the diagnosis over with `report_diagnosis`.',
  researcher: 'You are researching: hand the report over with `submit_report`.',
};

function resolveStepRefusal(run: Run) {
  return run.purpose ? PURPOSE_REFUSAL[run.purpose] : (ROLE_REFUSAL[run.role] ?? '');
}

function assertPurpose(run: Run, tool: ShinsaToolName) {
  if (!run.purpose || !isHandOverTool(tool) || PURPOSE_HAND_OVERS[run.purpose].includes(tool)) return;
  throw new DomainError('wrong_step', PURPOSE_REFUSAL[run.purpose]);
}

function assertTool(run: Run, tool: ShinsaToolName) {
  if (hasTool(run, tool)) {
    assertPurpose(run, tool);
    return;
  }
  if (tool === 'delegate_task' && (run.delegation?.depth ?? 0) >= DELEGATION_LIMITS.depth) {
    throw new DomainError(
      'delegation_depth',
      `Delegations nest at most ${DELEGATION_LIMITS.depth} deep, and this agent is already at that depth. Do the work yourself.`
    );
  }
  if (isTaskSessionRole(run.role) && !isDelegatedRun(run) && listToolNames(run.role).includes(tool)) {
    throw new DomainError('wrong_step', resolveStepRefusal(run));
  }
  throw new DomainError('wrong_role', `A ${run.role} cannot do that.`);
}

export function findCurrentRun(decider: Decider, runId: string, tool: ShinsaToolName) {
  const run = findRun(decider.state, runId);
  if (run.endedAt !== null) throw new DomainError('run_over', 'This step is already over. End your turn.');
  const task = decider.task(run.taskId);
  if (isTaskSettled(task)) throw new DomainError('task_settled', 'This task is finished. End your turn.');
  assertTool(run, tool);
  return { run, task };
}

function isStaleAttempt(run: Run, attemptId: string | null | undefined) {
  return Boolean(attemptId && run.attemptId && attemptId !== run.attemptId);
}

export function assertCurrentAttempt(decider: Decider, runId: string, attemptId: string | null | undefined) {
  const run = decider.state.runs[runId];
  if (run && isStaleAttempt(run, attemptId)) {
    throw new DomainError('attempt_stale', 'A newer attempt of this step has taken over. End your turn.');
  }
}

function spendRecovery(decider: Decider, task: Task) {
  decider.emit({
    type: 'task.recovered',
    taskId: task.id,
    recoveries: task.recoveries + 1,
    fingerprint: resolveRecoveryFingerprint(task),
  });
}

function recover(decider: Decider, run: Run, why: string, failure: RunFailure | null) {
  const task = decider.task(run.taskId);
  if (failure?.class === 'usage_limit' && waitForUsageReset(decider, run, failure)) return;
  if (failure?.class === 'auth' && requestSignIn(decider, run, failure)) return;
  const recovery = failure ? FAILURE_RECOVERY[failure.class] : RESUME;
  if (recovery.mode === 'pause') {
    decider.fail(task.id, recovery.title, `${why} Retry starts the step again.`, run.id);
    return;
  }
  if (task.recoveries >= MAX_RECOVERIES) {
    decider.fail(task.id, `The ${RUN_AGENT_ROLE[run.role]} paused`, why, run.id);
    return;
  }
  spendRecovery(decider, task);
  const role = run.role;
  const fresh = recovery.mode === 'fresh';
  const nudge = fresh ? resolveFreshSessionNudge(why) : resolveRecoveryNudge(why);
  decider.startRun(decider.task(task.id), role, `${run.rolePrompt ?? run.prompt ?? ''}${nudge}`, {
    resumeFrom: fresh ? null : decider.resumableFrom(run),
    purpose: run.purpose ?? null,
    phaseIndex: run.phaseIndex ?? null,
    monitorId: run.monitorId ?? null,
    account: run.account ?? null,
  });
}

function describeStop(outcome: RunOutcome, summary: string | null) {
  if (outcome === 'failed') return summary ?? 'it stopped with an error';
  return 'it ended its turn without calling the hand-over tool';
}

function finishRun(
  decider: Decider,
  run: Run,
  outcome: RunOutcome,
  summary: string | null,
  failure: RunFailure | null
) {
  if (outcome === 'completed' && hasOutstandingDelegations(decider.state, run)) {
    waitForDelegations(decider, run);
    return;
  }
  if (isDelegatedRun(run)) {
    settleDelegation(decider, run, outcome, summary, failure);
    return;
  }
  const held = listLiveChildRuns(decider.state, run.id).length > 0;
  if (held) decider.holdDelegations(run.id);
  decider.endRun(run, outcome, summary, failure);
  const task = decider.task(run.taskId);
  if (!isTaskSettled(task) && outcome !== 'cancelled' && RUN_STAGES.has(task.stage)) {
    recover(decider, run, failure?.message ?? describeStop(outcome, summary), failure);
  }
  if (held) decider.releaseDelegations(run.id);
}

export function endRun(decider: Decider, command: CommandOf<'run.end'>) {
  const run = decider.state.runs[command.runId];
  if (!run || run.endedAt !== null || isStaleAttempt(run, command.attemptId)) return;
  finishRun(decider, run, command.outcome, command.summary, command.failure ?? null);
}

export function linkRun(decider: Decider, command: CommandOf<'run.link'>) {
  const run = decider.state.runs[command.runId];
  if (!run || run.sessionId === command.sessionId || isStaleAttempt(run, command.attemptId)) return;
  decider.emit({
    type: 'run.linked',
    runId: command.runId,
    sessionId: command.sessionId,
    provider: command.provider,
  });
}

export function attemptRun(decider: Decider, command: CommandOf<'run.attempt'>) {
  const run = decider.state.runs[command.runId];
  if (!run || run.endedAt !== null || run.attemptId === command.attemptId) return;
  decider.emit({
    type: 'run.attempted',
    runId: run.id,
    attemptId: command.attemptId,
    provider: command.provider,
    model: command.model,
    resumed: command.resumed,
    handoff: command.handoff,
    ...(command.account ? { account: command.account } : {}),
    ...(command.cwd ? { cwd: command.cwd } : {}),
  });
}

function isRunning(run: Run) {
  return run.status !== 'queued' && run.status !== 'waiting';
}

export function interruptRun(decider: Decider, command: CommandOf<'run.interrupt'>) {
  const run = decider.state.runs[command.runId];
  if (!run || run.endedAt !== null || !isRunning(run) || run.resumePending) return;
  if (isStaleAttempt(run, command.attemptId) || isWaitingOnAnswer(decider.state, run)) return;
  decider.emit({ type: 'run.interrupted', runId: run.id });
}

function stopContinuing(decider: Decider, run: Run, code: string, message: string) {
  const failure: RunFailure = { class: 'aborted', message, code, retryable: null, resetAt: null };
  finishRun(decider, run, 'failed', message, failure);
}

export function continueRun(decider: Decider, command: CommandOf<'run.continue'>) {
  const run = decider.state.runs[command.runId];
  if (!run || run.endedAt !== null || !isRunning(run) || isWaitingOnAnswer(decider.state, run)) return;
  const since = decider.context.now - CONTINUATION_WINDOW_MS;
  const recent = (run.continuations ?? []).filter((at) => at > since).length;
  if (recent >= MAX_CONTINUATIONS) {
    const message = `Shinsa restarted ${recent + 1} times within 5 minutes while this step ran, so it stopped resuming it.`;
    stopContinuing(decider, run, 'restart_loop', message);
    return;
  }
  const task = decider.task(run.taskId);
  if (!run.resumePending) {
    if (task.recoveries >= MAX_RECOVERIES) {
      const message =
        'Shinsa stopped unexpectedly while this step ran, and the step made no progress since it was last resumed.';
      stopContinuing(decider, run, 'crash_loop', message);
      return;
    }
    spendRecovery(decider, task);
  }
  decider.emit({ type: 'run.continued', runId: run.id, reason: run.resumePending ? 'shutdown' : 'crash' });
  releaseWaits(decider, run.id);
}

export function recordSessionLost(decider: Decider, command: CommandOf<'run.record_lost_session'>) {
  const run = decider.state.runs[command.runId];
  if (!run) return;
  const known = Object.values(decider.state.runs).some(
    (candidate) => candidate.sessionId === command.sessionId && candidate.sessionLost !== true
  );
  if (!known) return;
  decider.emit({ type: 'run.session_lost', runId: run.id, sessionId: command.sessionId });
}

export function dispatchRuns(decider: Decider) {
  for (const { id } of listLiveRuns(decider.state)) {
    const run = decider.state.runs[id];
    if (run?.endedAt !== null || run.status !== 'queued' || holdForBudget(decider, run)) continue;
    decider.emit({ type: 'run.dispatched', runId: run.id });
    decider.run({ kind: 'run.execute', runId: run.id });
    planDelivery(decider, run.id);
  }
}
