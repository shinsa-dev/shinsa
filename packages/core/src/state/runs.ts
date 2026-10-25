import { addUsage } from '../costs/index.ts';
import type { Run, RunSilence } from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { applyDelegationStarted } from './delegations.ts';
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

function applyRunLinked(state: ShinsaState, event: EventOf<'run.linked'>) {
  const run = state.runs[event.runId];
  if (!run) return;
  state.runs[event.runId] = {
    ...run,
    sessionId: event.sessionId,
    sessionProvider: event.provider,
    ...(run.sessionLost ? { sessionLost: false } : {}),
  };
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

function applyRunMetered(state: ShinsaState, event: EventOf<'run.metered'>) {
  const run = state.runs[event.runId];
  updateRun(state, event.runId, {
    usage: addUsage(run?.usage, event.usage),
    ...(event.weeklyPercent === undefined
      ? {}
      : { weeklyPercent: (run?.weeklyPercent ?? 0) + event.weeklyPercent }),
  });
  if (event.sessionId && event.sessionUsage) state.sessionUsage[event.sessionId] = event.sessionUsage;
}

function updateSilence(state: ShinsaState, runId: string, patch: Partial<RunSilence>) {
  const run = state.runs[runId];
  if (!run) return;
  updateRun(state, runId, { silence: { ...QUIET, ...run.silence, ...patch } });
}

function applyRunStarted(state: ShinsaState, started: Run, at: number) {
  const run: Run = { ...started };
  state.runs[run.id] = run;
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
