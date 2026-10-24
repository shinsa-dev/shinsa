import {
  type MessageKind,
  needsMessageKind,
  ROUND_LIMITS,
  type RoundStatus,
  resolveCurrentRound,
  resolveTaskRounds,
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
import type { DispatchOptions, Engine } from '../runtime/engine.ts';
import { parseAnswerText, SHAPE_QUESTION } from './decisions.ts';

export interface MessageClass {
  kind: MessageKind;
  title: string | null;
  why: string | null;
  shape: TaskShape | null;
}

export type MessageClassifier = (task: Task, text: string) => Promise<MessageClass | null>;

interface MessageAnswer {
  kind?: unknown;
  shape?: unknown;
  title?: unknown;
  why?: unknown;
}

const MESSAGE_SYSTEM = [
  'You read one message a developer wrote in the chat of a coding task and decide what it asks for.',
  'A task is a conversation that runs in rounds: each round is one piece of work with its own plan, build, review and pull request, and new work for the same goal becomes the next round.',
  'Return one JSON object with the decisions listed after the message.',
  `title: what the new work does, imperative, sentence case, at most ${ROUND_LIMITS.title} characters, no trailing period.`,
  `why: one plain sentence of at most ${ROUND_LIMITS.why} characters saying why you decided that.`,
].join('\n');

const KIND_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions: 'What is this message?',
  criteria: {
    feedback:
      'about the work of the current round: a correction, an answer, guidance, a nudge or a question about what it does',
    new_round:
      'new work for this task that the current round does not cover: a new idea, an extension or the next step of the same goal',
    separate_task: 'work unrelated to the goal of this task, which belongs in a task of its own',
  },
};

const ROUND_STATE: Record<RoundStatus, string> = {
  queued: 'waiting',
  active: 'in progress',
  shipped: 'pull request open',
  merged: 'merged',
  finished: 'finished',
  cancelled: 'stopped',
};

function resolveMessageSchema(): JsonSchema {
  const properties: Record<string, unknown> = {
    kind: resolveDecisionProperty(KIND_QUESTION),
    shape: resolveDecisionProperty(SHAPE_QUESTION),
    title: { type: 'string', maxLength: ROUND_LIMITS.title },
    why: { type: 'string', maxLength: ROUND_LIMITS.why },
  };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function describeTask(task: Task) {
  const current = resolveCurrentRound(task);
  return [
    `Task: ${task.title}`,
    `It started from: ${task.intent.split('\n', 1)[0] ?? ''}`,
    'Its rounds:',
    ...resolveTaskRounds(task).map(
      (round) => `- Round ${round.number}: ${round.title} (${ROUND_STATE[round.status]})`
    ),
    `The current round, ${current.number}, is ${task.stageReason}.`,
  ];
}

export async function resolveMessageClass(
  task: Task,
  text: string,
  ask: QuickJson
): Promise<MessageClass | null> {
  const prompt = [
    ...describeTask(task),
    '',
    'Message:',
    text,
    '',
    'Decisions:',
    describeDecisionQuestion('kind', KIND_QUESTION),
    describeDecisionQuestion('shape', {
      ...SHAPE_QUESTION,
      instructions: 'If it is new work, what kind of work is it? Answer change when it is not new work.',
    }),
  ].join('\n');
  const answer = await ask<MessageAnswer>(MESSAGE_SYSTEM, prompt, resolveMessageSchema());
  const kind = answer ? (parseDecisionAnswer(KIND_QUESTION, answer.kind) as MessageKind | null) : null;
  if (!answer || !kind) return null;
  return {
    kind,
    title: parseAnswerText(answer.title, ROUND_LIMITS.title),
    why: parseAnswerText(answer.why, ROUND_LIMITS.why),
    shape: parseDecisionAnswer(SHAPE_QUESTION, answer.shape) as TaskShape | null,
  };
}

export function createMessageClassifier(ask: QuickJson): MessageClassifier {
  return (task, text) => resolveMessageClass(task, text, ask);
}

async function classifyCommand(
  engine: Engine,
  classify: MessageClassifier,
  command: Extract<UserCommand, { type: 'task.message' }>
): Promise<UserCommand> {
  const task = engine.state.tasks[command.taskId];
  if (!task || !needsMessageKind(engine.state, task)) return command;
  const found = await classify(task, command.text);
  if (!found) return command;
  return {
    ...command,
    kind: found.kind,
    ...(found.title ? { title: found.title } : {}),
    ...(found.why ? { why: found.why } : {}),
    ...(found.shape && found.kind !== 'feedback' ? { shape: found.shape } : {}),
  };
}

const classifying = new WeakMap<Engine, Map<string, Promise<UserCommand>>>();

async function routeMessage(
  engine: Engine,
  classify: MessageClassifier,
  command: Extract<UserCommand, { type: 'task.message' }>,
  options: DispatchOptions & { id: string }
) {
  const pending = classifying.get(engine) ?? new Map<string, Promise<UserCommand>>();
  classifying.set(engine, pending);
  const shared = pending.get(options.id);
  if (shared) return engine.dispatch(await shared, { ...options, receipt: command });
  const routed = classifyCommand(engine, classify, command);
  pending.set(options.id, routed);
  try {
    return await engine.dispatch(await routed, { ...options, receipt: command });
  } finally {
    pending.delete(options.id);
  }
}

export async function routeUserCommand(
  engine: Engine,
  command: UserCommand,
  id: string | null,
  classify: MessageClassifier | null,
  from: Pick<DispatchOptions, 'onBehalf' | 'byTask'> = {}
) {
  if (command.type !== 'task.message' || command.kind || !classify || (id && engine.hasReceipt(id))) {
    return engine.dispatch(command, id ? { ...from, id } : from);
  }
  if (id) return routeMessage(engine, classify, command, { ...from, id });
  return engine.dispatch(await classifyCommand(engine, classify, command), { ...from, receipt: command });
}

export function createCommandRouter(engine: Engine, classify: MessageClassifier | null): CommandRouter {
  return (command, from) => routeUserCommand(engine, command, from.id ?? null, classify, from);
}
