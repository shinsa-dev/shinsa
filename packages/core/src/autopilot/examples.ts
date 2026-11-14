import type { Option } from 'effect';
import type { Gate, Task } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { selectAutopilotModelGuess } from './model/learn.ts';
import { listAutopilotNeighbours } from './model/retrieve.ts';
import { AUTOPILOT_RETRIEVAL_LIMITS, type AutopilotModelGuess } from './model/schema.ts';
import { createAutopilotDecision } from './profile.ts';
import {
  AUTOPILOT_COMBINE_LIMITS,
  type AutopilotDecision,
  type AutopilotDecisionAnswer,
  type AutopilotGateKind,
} from './schema.ts';

export function createAutopilotProbe(
  state: ShinsaState,
  task: Task,
  gate: Gate,
  kind: AutopilotGateKind,
  now: number
): AutopilotDecision {
  return createAutopilotDecision(state, { task, gate, kind, answer: 'approved', note: null }, now);
}

export function selectAutopilotEstimate(
  state: ShinsaState,
  task: Task,
  gate: Gate,
  kind: AutopilotGateKind,
  now: number
): Option.Option<AutopilotModelGuess> {
  return selectAutopilotModelGuess(state.autopilotModel, createAutopilotProbe(state, task, gate, kind, now));
}

const KIND_NAME: Record<AutopilotGateKind, string> = {
  plan: 'A plan',
  question: 'A question',
  review: 'A review',
  merge: 'A merge',
  proposal: 'A proposal',
  failure: 'A failed step',
};

const ANSWER_TEXT: Partial<Record<AutopilotDecisionAnswer, string>> = {
  approved: 'approved it',
  revised: 'asked for changes',
  rejected: 'rejected it',
  replied: 'replied',
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function describeAutopilotEstimate(guess: AutopilotModelGuess) {
  const line = `Their personal model, learned from every decision they made: ${percent(guess.p)} that they approve this, from ${Math.round(guess.similar)} similar decisions.`;
  if (guess.confidence >= AUTOPILOT_COMBINE_LIMITS.confidence) return line;
  return `${line} It is still learning, so weigh it lightly.`;
}

function clip(text: string, limit: number) {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

function listExampleDetails(decision: AutopilotDecision) {
  const details: string[] = [];
  if (decision.risk) details.push(`${decision.risk} risk`);
  if (decision.scope) details.push(`${decision.scope.phases} phases, ${decision.scope.files} files`);
  if (decision.facts?.confidence) details.push(`reviewer confidence ${decision.facts.confidence}`);
  if (decision.urgent) details.push('urgent');
  if (decision.watchdog) details.push('filed by a watchdog');
  if (decision.facts) details.push(decision.facts.active ? 'they were active' : 'they were away');
  return details;
}

function describeExample(state: ShinsaState, kind: AutopilotGateKind, decision: AutopilotDecision) {
  const title = state.tasks[decision.taskId]?.title;
  const on = title ? ` on “${clip(title, AUTOPILOT_RETRIEVAL_LIMITS.title)}”` : '';
  const details = listExampleDetails(decision);
  const facts = details.length > 0 ? ` (${details.join(', ')})` : '';
  const answer = ANSWER_TEXT[decision.answer] ?? decision.answer;
  const words = decision.note ? ` They wrote: “${decision.note}”` : '';
  return `- ${KIND_NAME[kind]}${on}${facts}: they ${answer}.${words}`;
}

function resolveDecisionText(state: ShinsaState, decision: AutopilotDecision) {
  return [state.tasks[decision.taskId]?.title ?? '', decision.note ?? ''].join(' ');
}

function fitToBudget(lines: readonly string[]) {
  const fitted: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > AUTOPILOT_RETRIEVAL_LIMITS.budget) break;
    fitted.push(line);
    used += line.length + 1;
  }
  return fitted;
}

export function listAutopilotExampleLines(
  state: ShinsaState,
  task: Task,
  gate: Gate,
  kind: AutopilotGateKind,
  now: number
): string[] {
  const probe = createAutopilotProbe(state, task, gate, kind, now);
  const neighbours = listAutopilotNeighbours(
    state.autopilotHistory ?? [],
    probe,
    `${task.title} ${task.request}`,
    (decision) => resolveDecisionText(state, decision)
  );
  return fitToBudget(neighbours.map(({ decision }) => describeExample(state, kind, decision)));
}
