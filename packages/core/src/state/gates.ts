import { resolveAutopilotOpenedFacts } from '../autopilot/limits.ts';
import { type Gate, isAgentQuestion, isPausingGate } from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { describeDecision } from './activity.ts';
import { clearEscalation } from './autopilot.ts';
import { writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';
import { applyVerdicts } from './reviews.ts';
import { clearSuggestedActions } from './shapes.ts';
import { record, updateGate, updateTask } from './write.ts';

type GateEvent = Extract<
  ShinsaEvent,
  { type: 'gate.opened' | 'gate.answered' | 'gate.withdrawn' | 'gate.noted' | 'gate.superseded' }
>;

function writeApproveAfterFix(state: ShinsaState, taskId: string, at: number, approveAfterFix: boolean) {
  if ((state.tasks[taskId]?.approveAfterFix ?? false) === approveAfterFix) return;
  updateTask(state, taskId, at, { approveAfterFix });
}

function writeMergeAhead(state: ShinsaState, taskId: string, at: number, mergeAhead: boolean) {
  if ((state.tasks[taskId]?.mergeAhead ?? false) === mergeAhead) return;
  updateTask(state, taskId, at, { mergeAhead });
}

function describeAnswer(gate: Gate, event: EventOf<'gate.answered'>) {
  if (gate.type === 'result') return 'Closed the task';
  if (event.ahead && gate.type === 'merge') return `Merged once ready, as you asked: ${gate.title}`;
  if (event.autopilot && gate.type === 'failure') {
    const did = event.decision === 'reject' ? 'Cancelled' : 'Retried';
    return `${did} for you by Autopilot: ${gate.title}`;
  }
  if (event.autopilot && event.decision === 'revise') {
    const did = event.verdicts?.length ? 'Asked for changes' : 'Followed up';
    return `${did} for you by Autopilot: ${gate.title}`;
  }
  if (event.autopilot && gate.type === 'merge')
    return `Approved the merge for you by Autopilot: ${gate.title}`;
  if (event.autopilot && isAgentQuestion(gate)) return `Answered for you by Autopilot: ${gate.title}`;
  if (event.autopilot) return `Approved for you by Autopilot: ${gate.title}`;
  if (event.ahead) return `Approved after the fix, as you asked: ${gate.title}`;
  if (event.thenApprove && event.thenMerge)
    return `Asked for changes, then to approve and merge once ready: ${gate.title}`;
  if (event.thenApprove) return `Asked for changes and to approve after the fix: ${gate.title}`;
  if (event.thenMerge) return `Approved, to merge once ready: ${gate.title}`;
  return describeDecision(event.decision, gate.title);
}

function describeAnswerDetail(event: EventOf<'gate.answered'>) {
  if (!event.autopilot) return event.response;
  if (event.decision !== 'revise' || !event.response) return event.autopilot;
  return `${event.autopilot} It asked: “${event.response}”`;
}

function applyGateOpened(state: ShinsaState, event: EventOf<'gate.opened'>) {
  const gate = { ...event.gate, autopilotOpened: resolveAutopilotOpenedFacts(state, event.gate.openedAt) };
  writeEntry(state, 'gates', gate.id, gate);
  if (gate.type === 'review' || isPausingGate(gate))
    writeApproveAfterFix(state, gate.taskId, event.at, false);
  if (gate.type === 'review' && state.tasks[gate.taskId]?.autopiloted)
    updateTask(state, gate.taskId, event.at, { autopiloted: null });
  if (isAgentQuestion(gate)) {
    record(state, gate.taskId, event.at, {
      actor: 'agent',
      kind: 'question',
      text: gate.title,
      runId: gate.runId,
    });
    return;
  }
  if (!isPausingGate(gate)) return;
  record(state, gate.taskId, event.at, {
    actor: 'shinsa',
    kind: 'failure',
    text: gate.title,
    runId: gate.runId,
    gateType: gate.type,
  });
}

function clearSlackDecided(state: ShinsaState, taskId: string, at: number) {
  const link = state.tasks[taskId]?.slack;
  if (!link?.decided) return;
  updateTask(state, taskId, at, { slack: { ...link, decided: null } });
}

function applyGateAnswered(state: ShinsaState, event: EventOf<'gate.answered'>) {
  updateGate(state, event.gateId, {
    status: 'answered',
    decision: event.decision,
    response: event.response,
    answeredAt: event.at,
    ...(event.verdicts ? { verdicts: event.verdicts } : {}),
    ...(event.autopilot ? { autopilotAnswer: event.autopilot } : {}),
  });
  const gate = state.gates[event.gateId];
  if (!gate) return;
  if (event.verdicts) applyVerdicts(state, gate.taskId, event.at, event.verdicts);
  clearSlackDecided(state, gate.taskId, event.at);
  clearMergeEscalation(state, gate.id, event.at);
  clearSuggestedActions(state, gate.taskId, event.at);
  if (gate.type === 'review') writeApproveAfterFix(state, gate.taskId, event.at, event.thenApprove === true);
  if (gate.type === 'review' && !event.ahead)
    writeMergeAhead(state, gate.taskId, event.at, event.thenMerge === true);
  if (gate.type === 'merge') writeMergeAhead(state, gate.taskId, event.at, false);
  if (event.autopilot && event.decision === 'approve' && gate.type === 'review')
    updateTask(state, gate.taskId, event.at, { autopiloted: { at: event.at, reason: event.autopilot } });
  record(state, gate.taskId, event.at, {
    actor: event.autopilot ? 'shinsa' : 'you',
    kind: 'decision',
    text: describeAnswer(gate, event),
    detail: describeAnswerDetail(event),
    ...(event.comments ? { comments: event.comments } : {}),
  });
}

function clearMergeEscalation(state: ShinsaState, gateId: string, at: number) {
  const gate = state.gates[gateId];
  if (gate?.type === 'merge') clearEscalation(state, gate.taskId, at);
}

function applyGateWithdrawn(state: ShinsaState, event: EventOf<'gate.withdrawn'>) {
  updateGate(state, event.gateId, { status: 'withdrawn', answeredAt: event.at });
  clearMergeEscalation(state, event.gateId, event.at);
}

function applyGateSuperseded(state: ShinsaState, event: EventOf<'gate.superseded'>) {
  updateGate(state, event.gateId, { status: 'withdrawn', answeredAt: event.at, supersededBy: event.text });
  const gate = state.gates[event.gateId];
  if (!gate) return;
  record(state, gate.taskId, event.at, {
    actor: 'you',
    kind: 'question',
    text: `Replied in the chat instead of answering: ${gate.title}`,
  });
}

export function applyMergeGateKept(state: ShinsaState, event: EventOf<'task.merge_gate_kept'>) {
  writeMergeAhead(state, event.taskId, event.at, false);
  record(state, event.taskId, event.at, {
    actor: 'you',
    kind: 'decision',
    text: 'Kept the merge gate: the pull request waits for you to merge it',
  });
}

export function applyGateEvent(state: ShinsaState, event: GateEvent) {
  switch (event.type) {
    case 'gate.opened':
      applyGateOpened(state, event);
      return;
    case 'gate.answered':
      applyGateAnswered(state, event);
      return;
    case 'gate.withdrawn':
      applyGateWithdrawn(state, event);
      return;
    case 'gate.noted':
      updateGate(state, event.gateId, { notes: event.notes });
      return;
    case 'gate.superseded':
      applyGateSuperseded(state, event);
      return;
  }
}
