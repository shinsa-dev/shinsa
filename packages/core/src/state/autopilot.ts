import { learnAutopilotDecisions } from '../autopilot/model/learn.ts';
import {
  createAutopilotDecision,
  type DecisionDraft,
  recordAutopilotDecisions,
} from '../autopilot/profile.ts';
import { AUTOPILOT_LESSON_LIMITS, type AutopilotDecision } from '../autopilot/schema.ts';
import type { EventOf } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateGate, updateTask } from './write.ts';

export function applyAutopilotScheduled(state: ShinsaState, event: EventOf<'autopilot.scheduled'>) {
  updateGate(state, event.gateId, { autopilotDue: event.due });
}

export function applyAutopilotJudging(state: ShinsaState, event: EventOf<'autopilot.judging'>) {
  updateGate(state, event.gateId, { autopilotJudging: true });
}

export function applyAutopilotGuessed(state: ShinsaState, event: EventOf<'autopilot.guessed'>) {
  updateGate(state, event.gateId, { autopilotGuess: event.verdict });
}

export function applyAutopilotForwarded(state: ShinsaState, event: EventOf<'autopilot.forwarded'>) {
  const gate = state.gates[event.gateId];
  if (!gate) return;
  const judged = gate.autopilotJudging === true && gate.autopilotHeld !== event.reason;
  updateGate(state, event.gateId, {
    autopilotJudging: false,
    autopilotHeld: event.reason,
    autopilotTeaches: event.teaches,
  });
  if (!judged) return;
  record(state, gate.taskId, event.at, {
    actor: 'shinsa',
    kind: 'decision',
    text: `Brought to you by Autopilot: ${gate.title}`,
    detail: event.reason,
  });
}

export function applyAutopilotLearned(state: ShinsaState, event: EventOf<'autopilot.learned'>) {
  state.autopilotLessons = [...(state.autopilotLessons ?? []), ...event.lessons].slice(
    -AUTOPILOT_LESSON_LIMITS.kept
  );
  for (const lesson of event.lessons)
    if (lesson.kind === 'acted') updateGate(state, lesson.gateId, { autopilotLearned: true });
}

function recordDecisions(state: ShinsaState, decisions: readonly AutopilotDecision[]) {
  const { model, learned } = learnAutopilotDecisions(state.autopilotModel, decisions);
  state.autopilotProfile = recordAutopilotDecisions(state.autopilotProfile, learned);
  state.autopilotModel = model;
  state.autopilotHistory = [...(state.autopilotHistory ?? []), ...learned];
}

export function applyAutopilotDecided(state: ShinsaState, event: EventOf<'autopilot.decided'>) {
  recordDecisions(state, event.decisions);
}

function learnOne(
  state: ShinsaState,
  taskId: string,
  draft: Omit<DecisionDraft, 'task' | 'gate'>,
  at: number
) {
  const task = state.tasks[taskId];
  if (!task) return;
  const decision = createAutopilotDecision(state, { ...draft, task, gate: null }, at);
  recordDecisions(state, [decision]);
}

export function applyTaskRequestLearned(state: ShinsaState, event: EventOf<'task.created'>) {
  if (event.learned)
    learnOne(state, event.taskId, { kind: 'request', answer: 'filed', note: event.request }, event.at);
}

export function applyEditLearned(state: ShinsaState, event: EventOf<'task.edited'>) {
  if (event.learned)
    learnOne(state, event.taskId, { kind: 'edit', answer: 'edited', note: event.path }, event.at);
}

export function applyAutopilotSeen(state: ShinsaState, event: EventOf<'autopilot.seen'>) {
  for (const gateId of event.gateIds) updateGate(state, gateId, { autopilotSeen: true });
}

export function applyTaskEscalated(state: ShinsaState, event: EventOf<'task.escalated'>) {
  updateTask(state, event.taskId, event.at, {
    escalation: { at: event.at, reason: event.reason, handoff: event.handoff },
  });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'decision',
    text: 'Escalated by Autopilot',
    detail: event.reason,
  });
}

export function applyEscalationRevised(state: ShinsaState, event: EventOf<'task.escalation_revised'>) {
  const escalation = state.tasks[event.taskId]?.escalation;
  if (!escalation) return;
  updateTask(state, event.taskId, event.at, {
    escalation: { at: escalation.at, reason: event.reason, handoff: event.handoff },
  });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'decision',
    text: 'Autopilot could not merge it',
    detail: event.reason,
  });
}

export function clearEscalation(state: ShinsaState, taskId: string, at: number) {
  if (!state.tasks[taskId]?.escalation) return;
  updateTask(state, taskId, at, { escalation: null });
}
