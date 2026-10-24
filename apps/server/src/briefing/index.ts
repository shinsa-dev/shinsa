import {
  BRIEFING_LIMITS,
  type Briefing,
  type Gate,
  type GateType,
  parseBriefing,
  type Queue,
  type QueuedGate,
  resolveFallbackBriefing,
  resolveQueue,
  type ShinsaState,
  serializeBriefing,
} from '@shinsa/core';
import type { JsonSchema } from '../agents/providers/index.ts';
import {
  type ChoiceQuestion,
  describeDecisionQuestion,
  resolveDecisionProperty,
} from '../agents/quick/decide.ts';
import type { QuickJson } from '../agents/quick/index.ts';
import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';

const DEBOUNCE_MS = 4_000;

const HOUR_MS = 60 * 60 * 1000;

const BRIEFING_SYSTEM = [
  "You write the guide at the top of a developer's work queue in Shinsa.",
  'Agents do all the work. The developer only decides at gates: approve a plan, review finished changes, merge a clean pull request, answer a question, or decide what to do with paused work.',
  'From the decisions listed, pick the one to do now and the ones that follow.',
  'Return {"now": {"task": string, "why": string}, "next": [{"task": string, "why": string}], "note": string | null}.',
  'task: one option of the task field at the end of the prompt, copied exactly. next holds up to three other decisions in the order to take them, never the one in now.',
  'Keep the listed order unless a decision clearly unblocks other tasks or an agent is waiting on an answer; then that one goes first.',
  'Low priority decisions always come after every other decision, and one is never now while anything else is listed: they are finished, not urgent.',
  `why: one plain sentence of at most ${BRIEFING_LIMITS.why} characters on why this decision, and why at this point. It sits under the task title, so do not repeat the title.`,
  'Use only the facts given. Each decision says what it is: a review is built and checked and ready for review, not ready to merge. Say ready to merge only for a merge decision. A plan is not built yet.',
  'Never cite a pull request number, a repository or a branch: the task link shows them on hover. Say "the pull request is ready" instead.',
  'Refer to other tasks by their titles in quotes. Never by number, position or id: no "item three", no "the first one", and never write an id outside the task field.',
  `note: one heads-up sentence of at most ${BRIEFING_LIMITS.note} characters, only when something needs attention beyond the order: a paused task, a decision that has waited for days, work waiting on another task. Otherwise null.`,
  'The note must never name or describe a task that is in now or next: the guide already says why each of those matters, so put that in its why. If the only heads-up is about one of them, the note is null.',
  'Write whole sentences to the developer, not notes. Good why: "It has waited a day, and approving it lets the agent start on “Let the chat call tools”." Good note, about a decision not in now or next: "“Stop the preview flashing” is paused because the agent could not reproduce the flash."',
  'Plain, calm and specific. Sentence case, no greeting, no emoji, no em dashes, no exclamation marks.',
].join('\n');

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
  proposal: () =>
    'proposal: an agent proposes turning this task into a change; the developer approves or keeps it as it is',
  operation: (gate) => `operation: merged, waiting for the developer to run it: ${gate.title}`,
  failure: (gate) => `paused after a failure, needs a decision: ${gate.title}`,
  configuration: (gate) => `the setup needs fixing before any work starts: ${gate.title}`,
  sign_in: (gate) => `paused until the developer signs in again: ${gate.title}`,
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

function resolveTaskQuestion(queue: Queue): ChoiceQuestion {
  return {
    type: 'choice',
    instructions: 'The decision an item of the guide is about, for now.task and every next[].task.',
    criteria: Object.fromEntries(
      listDecisions(queue).map((entry) => [entry.task.id, `“${entry.task.title}”`])
    ),
  };
}

function resolveBriefingSchema(question: ChoiceQuestion): JsonSchema {
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
  const project = queue.focusProjectId ? state.projects[queue.focusProjectId]?.name : null;
  return [
    project ? `Focus: ${project}.` : 'No focus set.',
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

export async function resolveBriefing(
  state: ShinsaState,
  queue: Queue,
  now: number,
  ask: QuickJson
): Promise<Briefing> {
  const fallback = resolveFallbackBriefing(queue, now);
  if (queue.ready.length === 0) return fallback;
  const prompt = describeBriefingPrompt(state, queue, now);
  const answer = await ask<unknown>(
    BRIEFING_SYSTEM,
    prompt,
    resolveBriefingSchema(resolveTaskQuestion(queue))
  );
  return parseBriefing(answer, queue, now) ?? fallback;
}

export interface BriefingOptions {
  ask: QuickJson;
  debounceMs?: number;
}

export class Briefings {
  readonly #engine: Engine;
  readonly #ask: QuickJson;
  readonly #debounceMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #stopped = false;

  constructor(engine: Engine, options: BriefingOptions) {
    this.#engine = engine;
    this.#ask = options.ask;
    this.#debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  }

  schedule() {
    if (this.#stopped) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#write().catch((error: unknown) => {
        log.warn('[Briefing] Could not write the briefing', { error: describeError(error) });
      });
    }, this.#debounceMs);
  }

  stop() {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #write() {
    const state = this.#engine.state;
    const now = Date.now();
    const queue = resolveQueue(state, now);
    const briefing = await resolveBriefing(state, queue, now, this.#ask);
    if (this.#stopped) {
      log.info('[Briefing] Dropped a briefing that was written after the server stopped', { seq: state.seq });
      return;
    }
    await this.#engine.dispatch(
      {
        type: 'briefing.write',
        projectId: queue.focusProjectId,
        text: serializeBriefing(briefing, this.#engine.state),
        briefing,
      },
      { id: `briefing:${queue.focusProjectId ?? '*'}:${state.seq}` }
    );
  }
}
