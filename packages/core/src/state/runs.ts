import { addUsage, resolveMeterWindow } from '../costs/index.ts';
import {
  DELEGATE_ROLES,
  DomainError,
  isDelegatedRun,
  type Run,
  type RunMeter,
  type RunPurpose,
  type RunRole,
  type RunSilence,
} from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { applyDelegationStarted } from './delegations.ts';
import { writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';
import { updateRun } from './write.ts';

type RunEvent = Extract<
  ShinsaEvent,
  {
    type:
      | 'run.started'
      | 'run.dispatched'
      | 'run.ended'
      | 'run.interrupted'
      | 'run.continued'
      | 'run.linked'
      | 'run.attempted'
      | 'run.session_lost'
      | 'run.metered'
      | 'run.silenced'
      | 'run.silence_snoozed'
      | 'run.silence_dismissed'
      | 'run.compacted';
  }
>;

const QUIET: RunSilence = { since: null, snoozedUntil: null, dismissed: false };

const TOP_LEVEL_ROLES: readonly RunRole[] = ['agent', 'reviewer', 'answerer', 'investigator', 'researcher'];

const RUN_PURPOSES: readonly (RunPurpose | undefined)[] = ['plan', 'build', 'fix', 'operate', 'watch'];

function assertRunShape(run: Run) {
  const delegated = isDelegatedRun(run);
  const roles: readonly RunRole[] = delegated ? DELEGATE_ROLES : TOP_LEVEL_ROLES;
  if (!roles.includes(run.role)) {
    throw new DomainError(
      'run_role_unknown',
      `Run ${run.id} has the role "${run.role}", which ${delegated ? 'a delegated run' : 'a run of its own'} cannot have.`
    );
  }
  if (run.role === 'agent' && !RUN_PURPOSES.includes(run.purpose)) {
    throw new DomainError('run_purpose_unknown', `Agent run ${run.id} has no known purpose.`);
  }
  if (run.role !== 'agent' && run.purpose !== undefined) {
    throw new DomainError(
      'run_purpose_unexpected',
      `Run ${run.id} is a ${run.role} and cannot have a purpose.`
    );
  }
}

function applyRunLinked(state: ShinsaState, event: EventOf<'run.linked'>) {
  const run = state.runs[event.runId];
  if (!run) return;
  writeEntry(state, 'runs', event.runId, {
    ...run,
    sessionId: event.sessionId,
    sessionProvider: event.provider,
    ...(run.sessionLost ? { sessionLost: false } : {}),
  });
}

function applyRunAttempted(state: ShinsaState, event: EventOf<'run.attempted'>) {
  const run = state.runs[event.runId];
  if (!run) return;
  const attempt = {
    attemptId: event.attemptId,
    provider: event.provider,
    model: event.model,
    resumed: event.resumed,
    handoff: event.handoff,
    startedAt: event.at,
    ...(event.account ? { account: event.account } : {}),
    ...(event.cwd ? { cwd: event.cwd } : {}),
  };
  updateRun(state, event.runId, {
    attemptId: event.attemptId,
    attempts: [...(run.attempts ?? []), attempt],
  });
}

function applyRunSessionLost(state: ShinsaState, event: EventOf<'run.session_lost'>) {
  for (const run of Object.values(state.runs)) {
    if (run.sessionId === event.sessionId) updateRun(state, run.id, { sessionLost: true });
  }
}

function recordMeter(run: Run, event: EventOf<'run.metered'>): RunMeter[] | null {
  const attempt = run.attempts?.at(-1);
  if (!attempt) return null;
  const meters = run.meters ?? [];
  const meter = meters.find((candidate) => candidate.attemptId === attempt.attemptId);
  const recorded: RunMeter = {
    attemptId: attempt.attemptId,
    window: resolveMeterWindow(attempt),
    from: attempt.startedAt,
    to: event.at,
    usage: addUsage(meter?.usage, event.usage),
    readings: [...(meter?.readings ?? []), ...(event.readings ?? [])],
  };
  if (!meter) return [...meters, recorded];
  return meters.map((candidate) => (candidate === meter ? recorded : candidate));
}

function applyRunMetered(state: ShinsaState, event: EventOf<'run.metered'>) {
  const run = state.runs[event.runId];
  if (run) {
    const meters = recordMeter(run, event);
    updateRun(state, event.runId, { usage: addUsage(run.usage, event.usage), ...(meters ? { meters } : {}) });
  }
  if (event.sessionId && event.sessionUsage)
    writeEntry(state, 'sessionUsage', event.sessionId, event.sessionUsage);
}

function updateSilence(state: ShinsaState, runId: string, patch: Partial<RunSilence>) {
  const run = state.runs[runId];
  if (!run) return;
  updateRun(state, runId, { silence: { ...QUIET, ...run.silence, ...patch } });
}

function applyRunStarted(state: ShinsaState, started: Run, at: number) {
  assertRunShape(started);
  const run: Run = { ...started };
  writeEntry(state, 'runs', run.id, run);
  applyDelegationStarted(state, run, at);
}

export function applyRunEvent(state: ShinsaState, event: RunEvent) {
  switch (event.type) {
    case 'run.started':
      applyRunStarted(state, event.run, event.at);
      return;
    case 'run.dispatched':
      updateRun(state, event.runId, { status: 'running' });
      return;
    case 'run.ended':
      updateRun(state, event.runId, {
        endedAt: event.at,
        outcome: event.outcome,
        summary: event.summary,
        ...(event.failure ? { failure: event.failure } : {}),
      });
      return;
    case 'run.interrupted':
      updateRun(state, event.runId, { resumePending: true });
      return;
    case 'run.continued':
      updateRun(state, event.runId, {
        resumePending: false,
        continuations: [...(state.runs[event.runId]?.continuations ?? []), event.at],
      });
      return;
    case 'run.linked':
      applyRunLinked(state, event);
      return;
    case 'run.attempted':
      applyRunAttempted(state, event);
      return;
    case 'run.session_lost':
      applyRunSessionLost(state, event);
      return;
    case 'run.metered':
      applyRunMetered(state, event);
      return;
    case 'run.silenced':
      updateSilence(state, event.runId, { since: event.since });
      return;
    case 'run.silence_snoozed':
      updateSilence(state, event.runId, { snoozedUntil: event.until });
      return;
    case 'run.silence_dismissed':
      updateSilence(state, event.runId, { dismissed: true });
      return;
    case 'run.compacted':
      updateRun(state, event.runId, {
        compactions: [...(state.runs[event.runId]?.compactions ?? []), event.sessionId],
      });
      return;
  }
}
