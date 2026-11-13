import { Option } from 'effect';
import type { Gate, GateType, Task } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { listAutopilotLessonLines } from './lessons.ts';
import { resolveAutopilotFacts } from './limits.ts';
import { AUTOPILOT_JUDGMENT_LIMITS, type AutopilotFacts, type AutopilotGateKind } from './schema.ts';

export const AUTOPILOT_JUDGE_SYSTEM = [
  'You are Autopilot, the delegate of one developer who runs coding agents in Shinsa.',
  'Like a trusted employee, you handle what you are sure about and bring the rest to your boss.',
  'You are asked about one point where the work waits for the developer: a plan, an agent’s question, a review or a merge.',
  'Shinsa has already checked its hard limits: you may act here, but you never have to.',
  'Act only when the work is clear, small and low risk, and the developer would almost surely decide the same.',
  'Bring it to the developer when the scope is unclear, the change is large, the reviewer had doubts, the question needs their taste or knowledge, or you are unsure.',
  'An urgent fix a watchdog found while the developer is away may merge, when the reviewer rated it high confidence.',
  'To answer an agent’s question, write the reply the developer would give, in plain words, in `reply`; otherwise leave `reply` empty.',
  `Write \`reason\` as one plain sentence the developer reads later, at most ${AUTOPILOT_JUDGMENT_LIMITS.reason} characters.`,
  'Weigh what the developer taught you at earlier decisions like this one: do what they approved, bring what they changed.',
  'Answer with one JSON object and nothing else.',
].join('\n');

const GATE_NAME: Record<AutopilotGateKind, string> = {
  plan: 'Approve the plan',
  question: 'Answer the agent’s question',
  review: 'Approve the reviewed change',
  merge: 'Merge the pull request',
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

export function resolveAutopilotJudgePrompt(
  task: Task,
  gate: Gate,
  facts: AutopilotFacts,
  lessons: readonly string[] = []
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
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

const JUDGED_GATES: Partial<Record<GateType, AutopilotGateKind>> = {
  plan: 'plan',
  question: 'question',
  review: 'review',
  merge: 'merge',
};

export function selectJudgedGateKind(gate: Gate): Option.Option<AutopilotGateKind> {
  return Option.fromNullishOr(JUDGED_GATES[gate.type]);
}

export function selectAutopilotJudgeRequest(state: ShinsaState, gateId: string, now: number) {
  const gate = state.gates[gateId];
  const task = gate ? state.tasks[gate.taskId] : undefined;
  if (!gate || !task || gate.status !== 'open' || gate.autopilotJudging !== true) return Option.none();
  return Option.map(selectJudgedGateKind(gate), (kind) => {
    const facts = resolveAutopilotFacts(state, task, kind, gate.openedAt, now);
    const lessons = listAutopilotLessonLines(state, kind);
    return {
      system: AUTOPILOT_JUDGE_SYSTEM,
      prompt: resolveAutopilotJudgePrompt(task, gate, facts, lessons),
    };
  });
}
