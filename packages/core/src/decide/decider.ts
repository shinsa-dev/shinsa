import { RUN_AGENT_ROLE, resolveAgentModel, resolveAgentProvider } from '../agent-models/index.ts';
import {
  type Gate,
  type GateCause,
  type GateType,
  isAgentQuestion,
  isDelegatedRun,
  isLaterRound,
  isPausingGate,
  isTaskComplete,
  isTaskSettled,
  type Run,
  type RunAccount,
  type RunFailure,
  type RunOutcome,
  type RunRole,
  resolveRoundStamp,
  type Task,
  type TaskStage,
} from '../domain/index.ts';
import type { EffectCancellation, ShinsaEffect, ShinsaEffectKind } from '../effects/index.ts';
import type { ShinsaEventInput } from '../events/index.ts';
import { resolveAdoptionNote } from '../prompts/orchestration.ts';
import { resolveProjectContext } from '../prompts/project.ts';
import { listChildRuns, listLiveChildRuns } from '../state/delegations.ts';
import { applyEvent, type ShinsaState } from '../state/project.ts';
import { findTask, listActiveRuns, listOpenGates, resolveTaskProject } from '../state/queries.ts';
import { resolveRecoveryFingerprint } from './fingerprints.ts';

export interface DecideContext {
  now: number;
  newId: () => string;
  onBehalf?: boolean;
  byTask?: string | null;
}

export interface Decision {
  events: ShinsaEventInput[];
  effects: ShinsaEffect[];
  cancellations: EffectCancellation[];
}

interface StartRunOptions {
  resumeFrom?: Run | null;
  phaseIndex?: number | null;
  feedback?: string | null;
  monitorId?: string | null;
  usageWaitId?: string | null;
  account?: RunAccount | null;
}

interface KeptWaits {
  monitorId: string | null;
  usageWaitId: string | null;
}

type GateDetails = Partial<
  Pick<
    Gate,
    | 'planVersion'
    | 'choices'
    | 'recommendation'
    | 'cause'
    | 'escalation'
    | 'provider'
    | 'account'
    | 'secret'
    | 'commit'
    | 'notes'
  >
>;

interface OpenGateOptions {
  id?: string;
  runId?: string | null;
  details?: GateDetails;
}

const CASCADE_SUMMARY = 'Stopped because the agent that delegated it finished its step.';

export function quoteTitles(tasks: Task[]) {
  return tasks.map((task) => `“${task.title}”`).join(', ');
}

function resolveInheritedSession(from: Run): Partial<Run> {
  return {
    sessionProvider: from.sessionProvider ?? from.provider,
    ...(from.sessionLost ? { sessionLost: true } : {}),
  };
}

export class Decider {
  readonly #held = new Set<string>();
  readonly #runAccounts = new Map<string, RunAccount>();
  readonly events: ShinsaEventInput[] = [];
  readonly effects: ShinsaEffect[] = [];
  readonly cancellations: EffectCancellation[] = [];
  readonly state: ShinsaState;
  readonly context: DecideContext;

  constructor(state: ShinsaState, context: DecideContext) {
    this.state = structuredClone(state);
    this.context = context;
  }

  emit(event: ShinsaEventInput) {
    const byTask = this.context.byTask ? { byTask: this.context.byTask } : {};
    const stamped: ShinsaEventInput = this.context.onBehalf ? { ...event, onBehalf: true, ...byTask } : event;
    this.events.push(stamped);
    applyEvent(this.state, { ...stamped, seq: this.state.seq + 1, at: this.context.now });
  }

  run(effect: ShinsaEffect) {
    this.effects.push(effect);
  }

  cancelEffects(taskId: string, kinds: ShinsaEffectKind[], reason: string) {
    this.cancellations.push({ taskId, kinds, reason });
  }

  task(taskId: string) {
    return findTask(this.state, taskId);
  }

  repoOf(task: Pick<Task, 'repoId'>) {
    return task.repoId ? (this.state.repos[task.repoId] ?? null) : null;
  }

  basesOf(task: Task) {
    return task.waitsOn
      .map((id) => this.state.tasks[id])
      .filter((dependency): dependency is Task => dependency !== undefined && isTaskComplete(dependency));
  }

  requestBriefing(taskId: string) {
    const task = this.state.tasks[taskId];
    this.run({ kind: 'briefing.request', projectId: task ? resolveTaskProject(this.state, task) : null });
  }

  stage(taskId: string, stage: TaskStage, reason: string, by: 'you' | null = null) {
    const task = this.task(taskId);
    if (task.stage === stage && task.stageReason === reason) return;
    this.emit({ type: 'task.staged', taskId, stage, reason, ...(by ? { by } : {}) });
  }

  resumeRound(task: Task, roles: RunRole[]) {
    return isLaterRound(task) ? this.lastRun(task.id, roles) : null;
  }

  lastRun(taskId: string, roles: RunRole[]) {
    let latest: Run | null = null;
    for (const run of Object.values(this.state.runs)) {
      if (run.taskId !== taskId || !roles.includes(run.role) || isDelegatedRun(run)) continue;
      if (!latest || run.startedAt >= latest.startedAt) latest = run;
    }
    return latest;
  }

  endRun(run: Run, outcome: RunOutcome, summary: string | null, failure: RunFailure | null = null) {
    if (this.state.runs[run.id]?.endedAt !== null) return;
    this.emit({ type: 'run.ended', runId: run.id, outcome, summary, ...(failure ? { failure } : {}) });
    this.withdrawGates(run.taskId, (gate) => isAgentQuestion(gate) && gate.runId === run.id);
    if (this.#held.has(run.id)) return;
    for (const child of listLiveChildRuns(this.state, run.id)) this.stopRun(child, CASCADE_SUMMARY);
  }

  stopRun(run: Run, summary: string | null) {
    const queued = run.status === 'queued';
    this.endRun(run, 'cancelled', summary);
    if (!queued) this.run({ kind: 'run.cancel', runId: run.id });
  }

  holdDelegations(runId: string) {
    this.#held.add(runId);
  }

  releaseDelegations(runId: string) {
    this.#held.delete(runId);
    for (const child of listLiveChildRuns(this.state, runId)) this.stopRun(child, CASCADE_SUMMARY);
  }

  #listAdoptable(taskId: string, role: RunRole, phaseIndex: number | null) {
    const predecessors = [
      ...[...this.#held].map((id) => this.state.runs[id]),
      ...listActiveRuns(this.state, taskId),
    ].filter(
      (run): run is Run =>
        run !== undefined &&
        run.taskId === taskId &&
        run.role === role &&
        (run.phaseIndex ?? null) === phaseIndex
    );
    return predecessors.flatMap((run) =>
      listChildRuns(this.state, run.id).filter(
        (child) => child.endedAt === null || child.delegation.delivery === 'none'
      )
    );
  }

  #adopt(taskId: string, role: RunRole, phaseIndex: number | null) {
    const adopted = this.#listAdoptable(taskId, role, phaseIndex);
    if (adopted.length === 0) return { id: null, note: '' };
    const id = this.context.newId();
    for (const child of adopted) {
      this.emit({ type: 'delegation.adopted', runId: child.id, parentRunId: id });
      if (child.endedAt === null && child.delegation.wake !== 'always') {
        this.emit({ type: 'delegation.wake_changed', runId: child.id, wake: 'always' });
      }
    }
    const note = resolveAdoptionNote(
      adopted
        .filter((child) => child.endedAt === null)
        .map((child) => ({ runId: child.id, title: child.delegation.title }))
    );
    return { id, note };
  }

  cancelRuns(taskId: string) {
    for (const run of listActiveRuns(this.state, taskId)) this.stopRun(run, null);
  }

  startRun(task: Task, role: RunRole, prompt: string, options: StartRunOptions = {}) {
    const adoption = this.#adopt(task.id, role, options.phaseIndex ?? null);
    this.cancelRuns(task.id);
    this.withdrawGates(task.id, isPausingGate);
    this.clearWaits(task.id, {
      monitorId: options.monitorId ?? null,
      usageWaitId: options.usageWaitId ?? null,
    });
    const resumeFrom = options.resumeFrom?.sessionId ? options.resumeFrom : null;
    const account = this.#runAccounts.get(task.id) ?? options.account ?? null;
    this.#runAccounts.delete(task.id);
    const appended = `${resumeFrom ? '' : resolveProjectContext(this.state, task)}${adoption.note}`;
    const run: Run = {
      id: adoption.id ?? this.context.newId(),
      taskId: task.id,
      role,
      status: 'queued',
      phaseIndex: options.phaseIndex ?? null,
      prompt: `${prompt}${appended}`,
      ...(appended ? { rolePrompt: prompt } : {}),
      resume: resumeFrom !== null,
      provider: resolveAgentProvider(this.state.settings, RUN_AGENT_ROLE[role]),
      model: resolveAgentModel(this.state.settings, RUN_AGENT_ROLE[role]),
      sessionId: resumeFrom?.sessionId ?? null,
      startedAt: this.context.now,
      endedAt: null,
      outcome: null,
      summary: null,
      ...(resumeFrom ? resolveInheritedSession(resumeFrom) : {}),
      ...(options.feedback ? { feedback: options.feedback } : {}),
      ...(options.monitorId ? { monitorId: options.monitorId } : {}),
      ...(options.usageWaitId ? { usageWaitId: options.usageWaitId } : {}),
      ...(account ? { account } : {}),
      ...resolveRoundStamp(task),
    };
    this.emit({ type: 'run.started', run });
    return run;
  }

  bindNextRun(taskId: string, account: RunAccount) {
    this.#runAccounts.set(taskId, account);
  }

  clearWaits(taskId: string, keep: KeptWaits = { monitorId: null, usageWaitId: null }) {
    const { monitor, usageWait } = this.task(taskId);
    if (monitor && monitor.status !== 'exhausted' && monitor.id !== keep.monitorId) {
      this.emit({ type: 'monitor.ended', taskId, monitorId: monitor.id, status: 'cleared' });
    }
    if (usageWait && usageWait.id !== keep.usageWaitId) {
      this.emit({ type: 'usage_wait.ended', taskId, waitId: usageWait.id, status: 'cleared' });
    }
  }

  hasOpenGate(taskId: string, predicate: (gate: Gate) => boolean) {
    return listOpenGates(this.state, taskId).some(predicate);
  }

  openGate(taskId: string, type: GateType, title: string, body: string, options: OpenGateOptions = {}) {
    const gate: Gate = {
      id: options.id ?? this.context.newId(),
      taskId,
      type,
      status: 'open',
      title,
      body,
      runId: options.runId ?? null,
      openedAt: this.context.now,
      answeredAt: null,
      decision: null,
      response: null,
      ...options.details,
      ...resolveRoundStamp(this.task(taskId)),
    };
    this.emit({ type: 'gate.opened', gate });
    this.requestBriefing(taskId);
    return gate;
  }

  withdrawGates(taskId: string, predicate: (gate: Gate) => boolean) {
    for (const gate of listOpenGates(this.state, taskId)) {
      if (!predicate(gate)) continue;
      this.emit({ type: 'gate.withdrawn', gateId: gate.id });
      if (isAgentQuestion(gate)) this.run({ kind: 'question.resolve', gateId: gate.id });
    }
  }

  fail(taskId: string, title: string, detail: string, runId: string | null = null, cause?: GateCause) {
    if (isTaskSettled(this.task(taskId))) return;
    this.cancelRuns(taskId);
    this.clearWaits(taskId);
    this.withdrawGates(taskId, isPausingGate);
    this.openGate(taskId, 'failure', title, detail, {
      runId,
      ...(cause ? { details: { cause } } : {}),
    });
  }

  progressed(taskId: string) {
    const task = this.task(taskId);
    if (task.recoveries === 0) return;
    if (task.recoveryFingerprint && task.recoveryFingerprint === resolveRecoveryFingerprint(task)) return;
    this.emit({ type: 'task.recovered', taskId, recoveries: 0 });
  }

  resetRecoveries(taskId: string) {
    if (this.task(taskId).recoveries > 0) this.emit({ type: 'task.recovered', taskId, recoveries: 0 });
  }
}
