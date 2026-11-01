import {
  isTaskResting,
  type MessageKind,
  type MessageRoute,
  needsMessageKind,
  ROUND_LIMITS,
  type Round,
  type RoundStatus,
  resolveCurrentRound,
  resolveShapeOf,
  resolveTaskPipeline,
  resolveTaskRounds,
  type ShinsaState,
  type Task,
  type TaskShape,
  type UserCommand,
} from '@shinsa/core';
import type { CommandRouter } from '../agents/manage/index.ts';
import type { JsonSchema } from '../agents/providers/index.ts';
import {
  type ChoiceQuestion,
  describeDecisionQuestion,
  parseDecisionAnswer,
  resolveDecisionProperty,
} from '../agents/quick/decide.ts';
import type { QuickJson } from '../agents/quick/index.ts';
import type { LocalRepo } from '../repos/index.ts';
import type { DispatchOptions, Engine } from '../runtime/engine.ts';
import { parseAnswerText, SHAPE_QUESTION } from './decisions.ts';
import {
  describeProject,
  describeRepoCandidates,
  listOfferedRepos,
  NO_REPOSITORY,
  parseRepoAnswer,
  REPOSITORY_RULE,
  resolveCandidatePool,
  resolveRepoProperty,
} from './index.ts';

export interface MessageClass {
  kind: MessageKind;
  title: string | null;
  why: string | null;
  shape: TaskShape | null;
}

export type MessageClassifier = (task: Task, text: string) => Promise<MessageClass | null>;

export type ShapeClassifier = (task: Task, request: string) => Promise<TaskShape | null>;

export type RepositoryFinder = (state: ShinsaState, task: Task, local: LocalRepo[]) => Promise<string | null>;

export interface Classifier {
  message: MessageClassifier;
  shape: ShapeClassifier;
}

interface MessageAnswer {
  kind?: unknown;
  shape?: unknown;
  title?: unknown;
  why?: unknown;
}

const MESSAGE_SYSTEM = [
  'You read one message a developer wrote in the chat of a coding task and decide what it asks for.',
  'A task is a conversation that runs in rounds. Each round is one piece of work: an answer, research, an investigation, an operation, or a code change shipped as a pull request. New work for the same goal becomes the next round.',
  'Most messages need no new work. Thanks, an acknowledgement or small talk needs nothing, and a question about what a round did or found is answered in that round. Only a message that asks for something to be done that has not been done is new work.',
  'Return one JSON object with the decisions listed after the message.',
  `why: one plain sentence of at most ${ROUND_LIMITS.why} characters saying what the message asks for, and so why you decided that. Write it first.`,
  `title: what the new work does, imperative, sentence case, at most ${ROUND_LIMITS.title} characters, no trailing period; for anything else, what the message is about.`,
].join('\n');

const ACKNOWLEDGE =
  'needs nothing: thanks, an acknowledgement ("ok", "great", "sick thank you"), praise or small talk';

const SEPARATE_TASK =
  "asks for work toward another goal, which belongs in a task of its own; a message about this task's own work, its files, its steps or the parts it needs in other repositories is not this, even when it names another repository or checkout";

const RESTING_KIND_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions: 'Nothing is in progress in this task. What is this message?',
  criteria: {
    acknowledge: ACKNOWLEDGE,
    feedback:
      'a question about what the last round did, found or decided ("why did you pick X?", "where did Y go?"), answered from the work already done; nothing new is done',
    new_round:
      'asks for something to be done in this task: more work, the next step (such as opening a pull request), or a change to what the last round did, even a small correction ("actually do Z instead")',
    separate_task: SEPARATE_TASK,
  },
};

const WORKING_KIND_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions: 'A round of this task is in progress. What is this message?',
  criteria: {
    acknowledge: ACKNOWLEDGE,
    feedback:
      'about the work of the current round: a correction, an answer, guidance, a nudge or a question about what it does, including its files, its steps around the merge and what it needs in other repositories',
    new_round:
      'new work for this task that the current round does not cover: a new idea, an extension or the next step of the same goal',
    separate_task: SEPARATE_TASK,
  },
};

const GATE_STAGES: Partial<Record<Task['stage'], string>> = {
  awaiting_review: 'review',
  awaiting_merge: 'merge',
};

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

const MESSAGE_SHAPE_QUESTION: ChoiceQuestion = {
  ...SHAPE_QUESTION,
  instructions:
    'For new work (new_round or separate_task): what kind of task is it? Read the message as the request of a new task, with the rounds above as its context; a question about the code is an answer, not a change. For acknowledge or feedback answer "answer"; it is not used.',
};

const ROUND_SHAPE_SYSTEM = [
  'You read the request for the next round of a coding task and decide what kind of work it is.',
  'A task is a conversation that runs in rounds. Each round is one piece of work: an answer, research, an investigation, an operation, or a code change shipped as a pull request.',
  'Return one JSON object with the decision listed after the request.',
].join('\n');

const ROUND_SHAPE_QUESTION: ChoiceQuestion = {
  ...SHAPE_QUESTION,
  instructions:
    'What kind of task is this round? Read the request as the request of a new task, with the rounds above as its context; a question about the code is an answer, not a change.',
};

const ROUND_SHAPE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { shape: resolveDecisionProperty(ROUND_SHAPE_QUESTION) },
  required: ['shape'],
  additionalProperties: false,
};

const REPOSITORY_SYSTEM = [
  'You read what the current round of a coding task asks for and decide which repository on the developer’s machine its work happens in.',
  'The task has no repository yet, and this round’s work needs one: it changes code, investigates a problem or runs an operation.',
  `Return {"repo": string}: the exact name of one repository listed, or "${NO_REPOSITORY}".`,
  `Answer "${NO_REPOSITORY}" when nothing in the request, the change agreed to or the messages names a repository or clearly needs the code of one listed; the human is then asked which one.`,
  REPOSITORY_RULE,
].join('\n');

const ROUND_STATE: Record<RoundStatus, string> = {
  waiting: 'waiting',
  active: 'in progress',
  shipped: 'pull request open',
  merged: 'merged',
  finished: 'finished',
  cancelled: 'stopped',
};

const RESULT_EXCERPT = 400;

function resolveKindQuestion(task: Task) {
  if (isTaskResting(task)) return RESTING_KIND_QUESTION;
  const decision = GATE_STAGES[task.stage];
  return decision ? createGateKindQuestion(decision) : WORKING_KIND_QUESTION;
}

function resolveMessageSchema(kind: ChoiceQuestion): JsonSchema {
  const properties: Record<string, unknown> = {
    why: { type: 'string', maxLength: ROUND_LIMITS.why },
    kind: resolveDecisionProperty(kind),
    shape: resolveDecisionProperty(MESSAGE_SHAPE_QUESTION),
    title: { type: 'string', maxLength: ROUND_LIMITS.title },
  };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function describeOutcome(round: Round) {
  const text = round.outcome?.result ?? round.outcome?.headline ?? round.outcome?.goal ?? null;
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  const excerpt = flat.length > RESULT_EXCERPT ? `${flat.slice(0, RESULT_EXCERPT)}…` : flat;
  return ` What it did: ${excerpt}`;
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

function describeTask(task: Task) {
  return [
    `Task: ${task.title}`,
    `It started from: ${task.request.split('\n', 1)[0] ?? ''}`,
    'Its rounds:',
    ...resolveTaskRounds(task).map((round) => describeRound(task, round)),
    describeNow(task),
  ];
}

export async function resolveMessageClass(
  task: Task,
  text: string,
  ask: QuickJson
): Promise<MessageClass | null> {
  const kindQuestion = resolveKindQuestion(task);
  const prompt = [
    ...describeTask(task),
    '',
    'Message:',
    text,
    '',
    'Decisions:',
    describeDecisionQuestion('kind', kindQuestion),
    describeDecisionQuestion('shape', MESSAGE_SHAPE_QUESTION),
  ].join('\n');
  const answer = await ask<MessageAnswer>(MESSAGE_SYSTEM, prompt, resolveMessageSchema(kindQuestion));
  const kind = answer ? (parseDecisionAnswer(kindQuestion, answer.kind) as MessageKind | null) : null;
  if (!answer || !kind) return null;
  return {
    kind,
    title: parseAnswerText(answer.title, ROUND_LIMITS.title),
    why: parseAnswerText(answer.why, ROUND_LIMITS.why),
    shape: parseDecisionAnswer(MESSAGE_SHAPE_QUESTION, answer.shape) as TaskShape | null,
  };
}

export async function resolveRoundShape(
  task: Task,
  request: string,
  ask: QuickJson
): Promise<TaskShape | null> {
  const prompt = [
    ...describeTask(task),
    '',
    'Request for the next round:',
    request,
    '',
    'Decision:',
    describeDecisionQuestion('shape', ROUND_SHAPE_QUESTION),
  ].join('\n');
  const answer = await ask<{ shape?: unknown }>(ROUND_SHAPE_SYSTEM, prompt, ROUND_SHAPE_SCHEMA);
  return parseDecisionAnswer(ROUND_SHAPE_QUESTION, answer?.shape) as TaskShape | null;
}

function describeRoundWork(task: Task) {
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

export async function resolveRoundRepository(
  state: ShinsaState,
  task: Task,
  local: LocalRepo[],
  ask: QuickJson
): Promise<string | null> {
  const work = describeRoundWork(task);
  const pool = resolveCandidatePool(state, task, local, work.join('\n'));
  const offered = listOfferedRepos(pool);
  if (offered.length === 0) return null;
  const prompt = [
    ...describeTask(task),
    '',
    ...describeProject(pool),
    ...describeRepoCandidates(offered),
    '',
    ...work,
  ].join('\n');
  const answer = await ask<{ repo?: unknown }>(REPOSITORY_SYSTEM, prompt, {
    type: 'object',
    properties: { repo: resolveRepoProperty(offered, true) },
    required: ['repo'],
    additionalProperties: false,
  });
  return parseRepoAnswer(offered, answer?.repo, true) ?? null;
}

export function createClassifier(ask: QuickJson): Classifier {
  return {
    message: (task, text) => resolveMessageClass(task, text, ask),
    shape: (task, request) => resolveRoundShape(task, request, ask),
  };
}

function isNewWork(kind: MessageKind) {
  return kind === 'new_round' || kind === 'separate_task';
}

export function resolveMessageRoute(found: MessageClass | null): MessageRoute {
  if (!found) return {};
  return {
    kind: found.kind,
    ...(found.title ? { title: found.title } : {}),
    ...(found.why ? { why: found.why } : {}),
    ...(found.shape && isNewWork(found.kind) ? { shape: found.shape } : {}),
  };
}

type TaskMessage = Extract<UserCommand, { type: 'task.message' }>;

interface ShapelessRound {
  task: Task;
  command: TaskMessage | Extract<UserCommand, { type: 'suggestion.keep' }>;
  request: string;
}

async function classifyCommand(engine: Engine, classify: MessageClassifier, command: TaskMessage) {
  const task = engine.state.tasks[command.taskId];
  if (!task || !needsMessageKind(engine.state, task)) return command;
  return { ...command, ...resolveMessageRoute(await classify(task, command.text)) };
}

function selectShapelessRound(engine: Engine, command: UserCommand): ShapelessRound | null {
  if (command.type !== 'task.message' && command.type !== 'suggestion.keep') return null;
  const task = engine.state.tasks[command.taskId];
  if (!task || command.shape) return null;
  if (command.type === 'task.message') {
    return command.kind === 'new_round' ? { task, command, request: command.text } : null;
  }
  if (!isTaskResting(task)) return null;
  const suggestion = task.suggestions?.find((candidate) => candidate.id === command.suggestionId);
  return suggestion?.status === 'open' ? { task, command, request: suggestion.request } : null;
}

async function shapeCommand(classify: ShapeClassifier, { task, command, request }: ShapelessRound) {
  const shape = await classify(task, request);
  return shape ? { ...command, shape } : command;
}

const classifying = new WeakMap<Engine, Map<string, Promise<UserCommand>>>();

async function routeOnce(
  engine: Engine,
  command: UserCommand,
  options: DispatchOptions & { id: string },
  resolve: () => Promise<UserCommand>
) {
  const pending = classifying.get(engine) ?? new Map<string, Promise<UserCommand>>();
  classifying.set(engine, pending);
  const shared = pending.get(options.id);
  if (shared) return engine.dispatch(await shared, { ...options, receipt: command });
  const routed = resolve();
  pending.set(options.id, routed);
  try {
    return await engine.dispatch(await routed, { ...options, receipt: command });
  } finally {
    pending.delete(options.id);
  }
}

async function routeResolved(
  engine: Engine,
  command: UserCommand,
  id: string | null,
  from: Pick<DispatchOptions, 'onBehalf' | 'byTask' | 'guest'>,
  resolve: () => Promise<UserCommand>
) {
  if (id) return routeOnce(engine, command, { ...from, id }, resolve);
  return engine.dispatch(await resolve(), { ...from, receipt: command });
}

export function routeUserCommand(
  engine: Engine,
  command: UserCommand,
  id: string | null,
  classify: Classifier | null,
  from: Pick<DispatchOptions, 'onBehalf' | 'byTask' | 'guest'> = {}
) {
  const plain = id ? { ...from, id } : from;
  if (!classify || (id && engine.hasReceipt(id))) return engine.dispatch(command, plain);
  const shapeless = selectShapelessRound(engine, command);
  if (shapeless)
    return routeResolved(engine, command, id, from, () => shapeCommand(classify.shape, shapeless));
  if (command.type !== 'task.message' || command.kind) return engine.dispatch(command, plain);
  if (!(from.onBehalf || from.byTask || from.guest)) {
    const { taskId, text } = command;
    return engine.dispatch(
      { type: 'message.receive', taskId, text },
      { ...(id ? { id } : {}), receipt: command }
    );
  }
  return routeResolved(engine, command, id, from, () => classifyCommand(engine, classify.message, command));
}

export function createCommandRouter(engine: Engine, classify: Classifier | null): CommandRouter {
  return (command, from) => routeUserCommand(engine, command, from.id ?? null, classify, from);
}
