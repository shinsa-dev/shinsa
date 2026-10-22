import type { ShinsaEffect } from '../effects/index.ts';
import type { ShinsaEventInput } from '../events/index.ts';
import {
  type Gate,
  type GateKind,
  type GatePurpose,
  isTaskComplete,
  isTaskSettled,
  type Run,
  type RunOutcome,
  type RunRole,
  type Task,
  type TaskStage,
} from '../model/index.ts';
import { RUN_AGENT_ROLE, resolveAgentModel } from '../models/index.ts';
import { applyEvent, type ShinsaState } from '../state/project.ts';
import { findTask, listActiveRuns, listOpenGates, resolveTaskArea } from '../state/queries.ts';

export interface DecideContext {
  now: number;
  newId: () => string;
}

export interface Decision {
  events: ShinsaEventInput[];
  effects: ShinsaEffect[];
}

export interface StartRunOptions {
  resumeFrom?: Run | null;
  phaseIndex?: number | null;
}

export interface OpenGateOptions {
  id?: string;
  runId?: string | null;
}

export function quoteTitles(tasks: Task[]) {
  return tasks.map((task) => `“${task.title}”`).join(', ');
}

export class Decider {
  readonly events: ShinsaEventInput[] = [];
  readonly effects: ShinsaEffect[] = [];
  readonly state: ShinsaState;
  readonly context: DecideContext;

  constructor(state: ShinsaState, context: DecideContext) {
    this.state = structuredClone(state);
    this.context = context;
  }

  emit(event: ShinsaEventInput) {
    this.events.push(event);
    applyEvent(this.state, { ...event, seq: this.state.seq + 1, at: this.context.now });
  }

  run(effect: ShinsaEffect) {
    this.effects.push(effect);
  }

  task(taskId: string) {
    return findTask(this.state, taskId);
  }

  repoOf(task: Task) {
    return task.repoId ? (this.state.repos[task.repoId] ?? null) : null;
  }

  basesOf(task: Task) {
    const stacked = task.baseTaskId ? this.state.tasks[task.baseTaskId] : undefined;
    if (stacked) return [stacked];
    return task.blockedBy
      .map((id) => this.state.tasks[id])
      .filter((dependency): dependency is Task => dependency !== undefined && isTaskComplete(dependency));
  }

  requestBriefing(taskId: string) {
    const task = this.state.tasks[taskId];
    this.run({ kind: 'briefing.request', areaId: task ? resolveTaskArea(this.state, task) : null });
  }

  stage(taskId: string, stage: TaskStage, reason: string) {
    const task = this.task(taskId);
    if (task.stage === stage && task.stageReason === reason) return;
    this.emit({ type: 'task.staged', taskId, stage, reason });
  }

  lastRun(taskId: string, roles: RunRole[]) {
    let latest: Run | null = null;
    for (const run of Object.values(this.state.runs)) {
      if (run.taskId !== taskId || !roles.includes(run.role)) continue;
      if (!latest || run.startedAt >= latest.startedAt) latest = run;
    }
    return latest;
  }

  endRun(run: Run, outcome: RunOutcome, summary: string | null) {
    if (this.state.runs[run.id]?.endedAt !== null) return;
    this.emit({ type: 'run.ended', runId: run.id, outcome, summary });
    this.withdrawGates(run.taskId, (gate) => gate.purpose === 'agent_question' && gate.runId === run.id);
  }

  cancelRuns(taskId: string) {
    for (const run of listActiveRuns(this.state, taskId)) {
      this.endRun(run, 'cancelled', null);
      if (run.status !== 'queued') this.run({ kind: 'run.cancel', runId: run.id });
    }
  }

  startRun(task: Task, role: RunRole, prompt: string, options: StartRunOptions = {}) {
    this.cancelRuns(task.id);
    this.withdrawGates(task.id, (gate) => gate.purpose === 'failure');
    const resumeFrom = options.resumeFrom?.sessionId ? options.resumeFrom : null;
    const run: Run = {
      id: this.context.newId(),
      taskId: task.id,
      role,
      status: 'queued',
      phaseIndex: options.phaseIndex ?? null,
      prompt,
      resume: resumeFrom !== null,
      provider: this.state.settings.defaultProvider,
      model: resolveAgentModel(this.state.settings, RUN_AGENT_ROLE[role]),
      sessionId: resumeFrom?.sessionId ?? null,
      startedAt: this.context.now,
      endedAt: null,
      outcome: null,
      summary: null,
    };
    this.emit({ type: 'run.started', run });
    return run;
  }

  hasOpenGate(taskId: string, predicate: (gate: Gate) => boolean) {
    return listOpenGates(this.state, taskId).some(predicate);
  }

  openGate(
    taskId: string,
    kind: GateKind,
    purpose: GatePurpose,
    title: string,
    body: string,
    options: OpenGateOptions = {}
  ) {
    const gate: Gate = {
      id: options.id ?? this.context.newId(),
      taskId,
      kind,
      purpose,
      status: 'open',
      title,
      body,
      runId: options.runId ?? null,
      openedAt: this.context.now,
      answeredAt: null,
      decision: null,
      response: null,
    };
    this.emit({ type: 'gate.opened', gate });
    this.requestBriefing(taskId);
    return gate;
  }

  withdrawGates(taskId: string, predicate: (gate: Gate) => boolean) {
    for (const gate of listOpenGates(this.state, taskId)) {
      if (!predicate(gate)) continue;
      this.emit({ type: 'gate.withdrawn', gateId: gate.id });
      if (gate.purpose === 'agent_question') this.run({ kind: 'question.resolve', gateId: gate.id });
    }
  }

  fail(taskId: string, title: string, detail: string, runId: string | null = null) {
    if (isTaskSettled(this.task(taskId))) return;
    this.cancelRuns(taskId);
    this.withdrawGates(taskId, (gate) => gate.purpose === 'failure');
    this.openGate(taskId, 'question', 'failure', title, detail, { runId });
  }

  progressed(taskId: string) {
    if (this.task(taskId).recoveries > 0) this.emit({ type: 'task.recovered', taskId, recoveries: 0 });
  }
}
