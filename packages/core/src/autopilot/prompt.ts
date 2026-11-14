import { Option } from 'effect';
import type { Gate, GateType, Task, TaskSuggestion } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { describeAutopilotEstimate, listAutopilotExampleLines, selectAutopilotEstimate } from './examples.ts';
import { listAutopilotFollowUpLines } from './follow-ups.ts';
import { listAutopilotLessonLines } from './lessons.ts';
import { resolveAutopilotFacts } from './limits.ts';
import { listAutopilotKindLines, listAutopilotSteeringLines } from './profile.ts';
import {
  AUTOPILOT_JUDGMENT_LIMITS,
  AUTOPILOT_SUGGESTION_VERDICTS,
  AUTOPILOT_VERDICTS,
  type AutopilotFacts,
  type AutopilotGateKind,
} from './schema.ts';
import { listAutopilotTopicLines } from './topics.ts';

export const AUTOPILOT_JUDGE_SYSTEM = [
  'You are Autopilot, the delegate of one developer who runs coding agents in Shinsa.',
  'Like a trusted employee, you handle what you are sure about and bring the rest to your boss.',
  'You are asked about one point where the work waits for the developer: a plan, an agent’s question, a review, a merge, or an agent’s proposal on a task a watchdog filed.',
  'Shinsa has already checked its hard limits: you may act here, but you never have to.',
  'Act only when the work is clear, small and low risk, and the developer would almost surely decide the same.',
  'Bring it to the developer when the scope is unclear, the change is large, the reviewer had doubts, the question needs their taste or knowledge, or you are unsure.',
  'An urgent fix a watchdog found while the developer is away may merge, when the reviewer rated it high confidence.',
  'To answer an agent’s question, write the reply the developer would give, in plain words, in `reply`.',
  'On a plan, a review or a merge you may answer `revise` instead: one follow-up question or change request to the agent, in `reply`, written as the developer would write it, in their voice (“How does this handle auth on the new endpoint?”).',
  'Follow up only when one specific question or change would settle what the developer would ask, such as a topic they often probe; never repeat a follow-up already sent.',
  'For `act` and `forward` on anything but a question, leave `reply` empty.',
  `Write \`reason\` as one plain sentence the developer reads later, at most ${AUTOPILOT_JUDGMENT_LIMITS.reason} characters.`,
  'Weigh what the developer taught you at earlier decisions like this one: do what they approved, bring what they changed.',
  'Weigh their personal model’s estimate and the earlier decisions most like this one: what they did there, and their words, is what they would do here.',
  'Weigh how they steer their tasks: the counts and their recent words are their habits.',
  'Answer with one JSON object and nothing else.',
].join('\n');

const GATE_NAME: Record<AutopilotGateKind, string> = {
  plan: 'Approve the plan',
  question: 'Answer the agent’s question',
  review: 'Approve the reviewed change',
  merge: 'Merge the pull request',
  proposal: 'Give your OK on the agent’s proposal for a task a watchdog filed',
};

function clip(text: string, limit: number) {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

function describePresence(facts: AutopilotFacts) {
  const { presence } = facts;
  if (presence.active) return 'active now';
  const hours =
    presence.inHours === null
      ? 'hours not known yet'
      : presence.inHours
        ? 'inside their usual hours'
        : 'outside their usual hours';
  const away = presence.awayMinutes === null ? 'not seen yet' : `away ${presence.awayMinutes} minutes`;
  return `${away}, ${hours}`;
}

function describeFacts(facts: AutopilotFacts) {
  return [
    `Urgent: ${facts.urgent ? 'yes' : 'no'}`,
    `Filed by a watchdog: ${facts.watchdog ? 'yes' : 'no'}`,
    `Reviewer confidence: ${facts.confidence ?? 'not rated yet'}`,
    `Reviewer risk: ${facts.risk ?? 'not rated yet'}`,
    `Plan size: ${facts.scope ? `${facts.scope.phases} phases, ${facts.scope.files} files` : 'no plan yet'}`,
    `Waiting for: ${facts.waitedMinutes} minutes`,
    `The developer: ${describePresence(facts)}`,
  ].map((line) => `- ${line}`);
}

function describeChoices(gate: Gate) {
  const choices = gate.choices ?? [];
  if (choices.length === 0) return [];
  const recommended = gate.recommendation ? ` (the agent recommends: ${gate.recommendation})` : '';
  return [`Choices${recommended}:`, ...choices.map((choice) => `- ${choice}`)];
}

function describeLessons(lessons: readonly string[]) {
  if (lessons.length === 0) return [];
  return ['', 'What the developer taught you at earlier ones, most recent first:', ...lessons];
}

export interface AutopilotHistoryLines {
  estimate: string | null;
  examples: readonly string[];
  steering: readonly string[];
  topics?: readonly string[];
}

const NO_HISTORY: AutopilotHistoryLines = { estimate: null, examples: [], steering: [] };

function describeHistory({ estimate, examples, steering, topics = [] }: AutopilotHistoryLines) {
  const lines: string[] = [];
  if (estimate) lines.push('', estimate);
  if (examples.length > 0)
    lines.push('', 'Earlier decisions most like this one, with or without you:', ...examples);
  if (steering.length > 0) lines.push('', ...steering);
  if (topics.length > 0) lines.push('', ...topics);
  return lines;
}

function describeShadow(shadow: boolean) {
  if (!shadow) return [];
  return ['', AUTOPILOT_SHADOW_NOTE];
}

export const AUTOPILOT_SHADOW_NOTE =
  'Autopilot will not act here: this point is the developer’s. Guess what they will do: `act` if they approve it as it is, `revise` with the follow-up they would write in `reply` if they ask for a change or a follow-up, `forward` if they reject it or you cannot tell.';

function describeFollowUpOnly(gate: Gate, shadow: boolean) {
  if (shadow || !gate.autopilotFollowUpOnly) return [];
  return [
    '',
    `You may not approve this one: ${gate.autopilotFollowUpOnly} Answer \`revise\` with one follow-up, or \`forward\` it to the developer.`,
  ];
}

export function resolveAutopilotJudgePrompt(
  task: Task,
  gate: Gate,
  facts: AutopilotFacts,
  lessons: readonly string[] = [],
  history: AutopilotHistoryLines = NO_HISTORY,
  shadow = false,
  followUps: readonly string[] = []
) {
  const limit = AUTOPILOT_JUDGMENT_LIMITS.context;
  return [
    `Decision: ${GATE_NAME[facts.gate]}`,
    '',
    `Task: ${task.title}`,
    `Request: ${clip(task.request, limit)}`,
    '',
    'Facts:',
    ...describeFacts(facts),
    '',
    `${gate.title}`,
    clip(gate.body, limit * 2),
    ...describeChoices(gate),
    ...describeLessons(lessons),
    ...describeHistory(history),
    ...(followUps.length > 0 ? ['', ...followUps] : []),
    ...describeFollowUpOnly(gate, shadow),
    ...describeShadow(shadow),
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

const JUDGED_GATES: Partial<Record<GateType, AutopilotGateKind>> = {
  plan: 'plan',
  question: 'question',
  review: 'review',
  merge: 'merge',
  proposal: 'proposal',
};

export function selectJudgedGateKind(gate: Gate): Option.Option<AutopilotGateKind> {
  return Option.fromNullishOr(JUDGED_GATES[gate.type]);
}

function isAwaitingJudgment(gate: Gate, shadow: boolean) {
  if (shadow) return gate.autopilotJudging !== true && gate.autopilotGuess === undefined;
  return gate.autopilotJudging === true;
}

export function selectAutopilotJudgeRequest(state: ShinsaState, gateId: string, now: number, shadow = false) {
  const gate = state.gates[gateId];
  const task = gate ? state.tasks[gate.taskId] : undefined;
  if (!gate || !task || gate.status !== 'open' || !isAwaitingJudgment(gate, shadow)) return Option.none();
  return Option.map(selectJudgedGateKind(gate), (kind) => {
    const facts = resolveAutopilotFacts(state, task, kind, gate.openedAt, now);
    const lessons = listAutopilotLessonLines(state, kind);
    const estimate = selectAutopilotEstimate(state, task, gate, kind, now);
    const history: AutopilotHistoryLines = {
      estimate: Option.getOrNull(Option.map(estimate, describeAutopilotEstimate)),
      examples: listAutopilotExampleLines(state, task, gate, kind, now),
      steering: listAutopilotSteeringLines(state, { projectId: task.projectId ?? null, risk: facts.risk }),
      topics: listAutopilotTopicLines(state.autopilotProfile),
    };
    return {
      system: AUTOPILOT_JUDGE_SYSTEM,
      prompt: resolveAutopilotJudgePrompt(
        task,
        gate,
        facts,
        lessons,
        history,
        shadow,
        listAutopilotFollowUpLines(state, gate)
      ),
      verdicts: AUTOPILOT_VERDICTS,
    };
  });
}

export const AUTOPILOT_SUGGESTION_SYSTEM = [
  'You are Autopilot, the delegate of one developer who runs coding agents in Shinsa.',
  'An agent suggested a new task while it worked on another. Decide what the developer would do with it.',
  'Shinsa has already checked its hard limits: you may decide here, but you never have to.',
  '`accept` adds it as a task of its own, which still passes every gate: only when it is clearly worth doing and the developer would almost surely add it.',
  '`dismiss` drops it: only when it is clearly not worth doing, repeats work, or the developer usually dismisses ones like it.',
  '`forward` leaves it for the developer: whenever you are unsure, or it needs their taste or priorities.',
  'Weigh how they usually decide suggested tasks: the counts and their recent words are their habits.',
  `Write \`reason\` as one plain sentence the developer reads later, at most ${AUTOPILOT_JUDGMENT_LIMITS.reason} characters, and leave \`reply\` empty.`,
  'Answer with one JSON object and nothing else.',
].join('\n');

export function resolveAutopilotSuggestionPrompt(
  task: Task,
  suggestion: TaskSuggestion,
  profile: readonly string[] = []
) {
  const limit = AUTOPILOT_JUDGMENT_LIMITS.context;
  return [
    'Decision: Add or dismiss a suggested task',
    '',
    `Suggested while working on: ${task.title}`,
    '',
    `Suggested task: ${suggestion.title}`,
    `Request: ${clip(suggestion.request, limit)}`,
    `Why the agent suggests it: ${clip(suggestion.why, limit)}`,
    `Starts: ${suggestion.waitsOnThis ? 'after this task merges' : 'at once'}`,
    ...(profile.length > 0 ? ['', 'How the developer decides suggested tasks:', ...profile] : []),
  ].join('\n');
}

export function selectAutopilotSuggestionRequest(state: ShinsaState, taskId: string, suggestionId: string) {
  const task = state.tasks[taskId];
  const suggestion = task?.suggestions?.find((candidate) => candidate.id === suggestionId);
  if (!task || !suggestion || suggestion.status !== 'open') return Option.none();
  const profile = listAutopilotKindLines(state, ['suggestion'], {
    projectId: task.projectId ?? null,
    risk: null,
  });
  return Option.some({
    system: AUTOPILOT_SUGGESTION_SYSTEM,
    prompt: resolveAutopilotSuggestionPrompt(task, suggestion, profile),
    verdicts: AUTOPILOT_SUGGESTION_VERDICTS,
  });
}
