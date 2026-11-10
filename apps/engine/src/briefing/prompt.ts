import {
  type Gate,
  type GateType,
  type Queue,
  type QueuedGate,
  type ShinsaState,
  BRIEFING_LIMITS,
  describeFocusProjects,
} from '@shinsa/core';
import { Option } from 'effect';
import type { JsonSchema } from '../agents/providers/index.ts';
import {
  type ChoiceQuestion,
  describeDecisionQuestion,
  resolveDecisionProperty,
} from '../agents/quick/decide.ts';
import { HOUR_MS } from './schema.ts';

function describeAge(openedAt: number, now: number) {
  const hours = Math.floor((now - openedAt) / HOUR_MS);
  if (hours < 1) return 'opened under an hour ago';
  if (hours < 48) return `waiting ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `waiting ${Math.floor(hours / 24)} days`;
}

function describeAsked(gate: Gate) {
  return `an agent asks: ${gate.title}`;
}

const GATE_FACTS: Record<GateType, (gate: Gate) => string> = {
  plan: () => 'plan approval: the plan is written, nothing is built yet',
  review: () =>
    'review: built, checks passed and agent review clean, waiting for the developer to review the changes. Not merged, no pull request yet',
  merge: () => 'merge: the pull request is open, CI and review clean, ready to merge',
  question: describeAsked,
  secret: describeAsked,
  browser_sign_in: (gate) =>
    `an agent waits for the developer to sign its project’s browser in: ${gate.title}`,
  proposal: () =>
    'proposal: an agent proposes turning this task into a change; the developer approves or keeps it as it is',
  operation: (gate) => `operation: merged, waiting for the developer to run it: ${gate.title}`,
  failure: (gate) => `paused after a failure, needs a decision: ${gate.title}`,
  configuration: (gate) => `the setup needs fixing before any work starts: ${gate.title}`,
  sign_in: (gate) => `paused until the developer signs in again: ${gate.title}`,
  post_merge: (gate) =>
    `after the merge: merged, and the task is done once the developer does the steps it left them: ${gate.title}`,
  result: (gate) =>
    `answered: the answer, report or diagnosis is ready, and the task is done once the developer reads and closes it: ${gate.title}`,
};

function describeGate(gate: Gate) {
  if (gate.escalation)
    return 'review: the agents could not settle the review, the developer decides on the findings';
  return GATE_FACTS[gate.type](gate);
}

function listWaitingTitles(state: ShinsaState, taskId: string) {
  return Object.values(state.tasks)
    .filter((task) => task.waitsOn.includes(taskId) && task.stage !== 'merged' && task.stage !== 'cancelled')
    .map((task) => `“${task.title}”`);
}

function describeDecision(state: ShinsaState, entry: QueuedGate, now: number) {
  const facts = [describeGate(entry.gate), describeAge(entry.gate.openedAt, now)];
  if (entry.unblocks > 0) facts.push(`unblocks ${listWaitingTitles(state, entry.task.id).join(', ')}`);
  if (entry.task.priority !== 'normal') facts.push(`${entry.task.priority} priority`);
  const repo = entry.task.repoId ? state.repos[entry.task.repoId]?.name : undefined;
  if (repo) facts.push(`in ${repo}`);
  return `- id ${entry.task.id}: “${entry.task.title}”. ${facts.join('; ')}.`;
}

function listDecisions(queue: Queue) {
  const seen = new Set<string>();
  return queue.ready.filter((entry) => {
    if (seen.has(entry.task.id)) return false;
    seen.add(entry.task.id);
    return true;
  });
}

export function resolveTaskQuestion(queue: Queue): ChoiceQuestion {
  return {
    type: 'choice',
    instructions: 'The decision an item of the guide is about, for now.task and every next[].task.',
    criteria: Object.fromEntries(
      listDecisions(queue).map((entry) => [entry.task.id, `“${entry.task.title}”`])
    ),
  };
}

export function resolveBriefingSchema(question: ChoiceQuestion): JsonSchema {
  const item = {
    type: 'object',
    properties: { task: resolveDecisionProperty(question), why: { type: 'string' } },
    required: ['task', 'why'],
    additionalProperties: false,
  };
  return {
    type: 'object',
    properties: {
      now: item,
      next: { type: 'array', items: item, maxItems: BRIEFING_LIMITS.next },
      note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
    required: ['now', 'next', 'note'],
    additionalProperties: false,
  };
}

export function describeBriefingPrompt(state: ShinsaState, queue: Queue, now: number) {
  const decisions = listDecisions(queue);
  const working = queue.working.map((task) => `- “${task.title}” (${task.stage})`);
  const waiting = queue.waiting.map((task) => {
    const blocker = task.waitsOn.map((id) => state.tasks[id]?.title).find(Boolean);
    return `- “${task.title}”, not started: waiting for “${blocker ?? 'another task'}” to finish`;
  });
  const focus = describeFocusProjects(queue.focus, (projectId) => state.projects[projectId]?.name);
  return [
    Option.match(focus, { onNone: () => 'No focus set.', onSome: (named) => `Focus: ${named}.` }),
    'Decisions that need the developer, in ranked order:',
    ...decisions.map((entry) => describeDecision(state, entry, now)),
    '',
    'Agents are working on:',
    ...(working.length > 0 ? working : ['(nothing)']),
    ...(waiting.length > 0 ? ['', 'Waiting:', ...waiting] : []),
    '',
    'The task field:',
    describeDecisionQuestion('task', resolveTaskQuestion(queue)),
  ].join('\n');
}
