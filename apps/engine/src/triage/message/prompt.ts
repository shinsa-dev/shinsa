import {
  isTaskResting,
  listDuePostMergeSteps,
  type Round,
  resolveCurrentRound,
  resolveShapeOf,
  resolveTaskPipeline,
  resolveTaskRounds,
  ROUND_LIMITS,
  type Task,
} from '@shinsa/core';
import type { JsonSchema } from '../../agents/providers/index.ts';
import { type ChoiceQuestion, resolveDecisionProperty } from '../../agents/quick/decide.ts';
import {
  ACKNOWLEDGE,
  GATE_STAGES,
  MESSAGE_SHAPE_QUESTION,
  RESTING_KIND_QUESTION,
  RESULT_EXCERPT,
  ROUND_STATE,
  SEPARATE_TASK,
  STEP_EXCERPT,
  WORKING_KIND_QUESTION,
} from './schema.ts';

function createGateKindQuestion(decision: string): ChoiceQuestion {
  return {
    type: 'choice',
    instructions: `The work of the current round is finished and waits for the human to ${decision} it. Nothing else is in progress. What is this message?`,
    criteria: {
      acknowledge: ACKNOWLEDGE,
      feedback: `about this round before the ${decision}: a change to it, something to run or start for it so the human can try it (a dev server, a service, a script), something to check, a question about it, or its files, its steps around the merge and what it needs in other repositories (even when the message names another checkout)`,
      new_round:
        'the next piece of work after this round: a new idea or an extension of the same goal that is a code change of its own, not something needed to try or finish this round',
      separate_task: SEPARATE_TASK,
    },
  };
}

export function resolveKindQuestion(task: Task) {
  if (isTaskResting(task)) return RESTING_KIND_QUESTION;
  const decision = GATE_STAGES[task.stage];
  return decision ? createGateKindQuestion(decision) : WORKING_KIND_QUESTION;
}

export function resolveMessageSchema(kind: ChoiceQuestion): JsonSchema {
  const properties: Record<string, unknown> = {
    why: { type: 'string', maxLength: ROUND_LIMITS.why },
    kind: resolveDecisionProperty(kind),
    shape: resolveDecisionProperty(MESSAGE_SHAPE_QUESTION),
    title: { type: 'string', maxLength: ROUND_LIMITS.title },
  };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function excerptText(text: string, limit: number) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function describeOutcome(round: Round) {
  const text = round.outcome?.result ?? round.outcome?.headline ?? round.outcome?.goal ?? null;
  if (!text) return '';
  return ` What it did: ${excerptText(text, RESULT_EXCERPT)}`;
}

function describeOpenSteps(task: Task) {
  const steps = listDuePostMergeSteps(task);
  if (steps.length === 0) return [];
  return [
    'Steps left for the human after the merge (the human does these, not an agent):',
    ...steps.map((step) => `- ${step.title}: ${excerptText(step.detail, STEP_EXCERPT)}`),
  ];
}

function describeRound(task: Task, round: Round) {
  const shape = resolveShapeOf(round.pipeline.length > 0 ? round.pipeline : resolveTaskPipeline(task));
  return `- Round ${round.number}: ${round.title} (${shape}, ${ROUND_STATE[round.status]}).${describeOutcome(round)}`;
}

function describeNow(task: Task) {
  const current = resolveCurrentRound(task);
  if (isTaskResting(task)) return `Now: round ${current.number} is done and nothing is in progress.`;
  const decision = GATE_STAGES[task.stage];
  if (decision) return `Now: round ${current.number} is finished and waits for the human to ${decision} it.`;
  return `Now: round ${current.number} is in progress, ${task.stageReason}.`;
}

export function describeTask(task: Task) {
  return [
    `Task: ${task.title}`,
    `It started from: ${task.request.split('\n', 1)[0] ?? ''}`,
    'Its rounds:',
    ...resolveTaskRounds(task).map((round) => describeRound(task, round)),
    describeNow(task),
    ...describeOpenSteps(task),
  ];
}

export function describeRoundWork(task: Task) {
  const round = resolveCurrentRound(task);
  const messages = task.activity.flatMap((entry) =>
    entry.kind === 'message' && entry.detail && (entry.round ?? 1) === round.number
      ? [`- ${entry.detail}`]
      : []
  );
  const agreed = task.proposal?.status === 'accepted' ? task.proposal.request : null;
  return [
    'What this round asks for:',
    round.request,
    ...(agreed ? ['', 'The change the human agreed to:', agreed] : []),
    ...(messages.length > 0 ? ['', 'The human added since:', ...messages] : []),
  ];
}
