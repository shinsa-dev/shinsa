import { TASK_SHAPES, type TaskShape } from '@shinsa/core';
import type { ChoiceQuestion } from '../agents/quick/decide.ts';

const SHAPE_MEANINGS: Record<TaskShape, string> = {
  answer:
    'a question answered from the code, or a request to set up an automation (a schedule, a trigger or a watch of an integration) that its agent sets or suggests for the human to accept; nothing in the code changes',
  investigate: 'find the cause of a problem and report it, may propose a fix for the human’s OK',
  research: 'compare options or research a topic and write a report',
  change: 'change the code and ship it as a pull request',
  fix: 'find the cause of a bug first, then fix it and ship a pull request',
  operation:
    'run a one-off action in the repository (a script, a migration, a cleanup) without a pull request, after the human approves its plan',
};

export const SHAPE_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions: 'What kind of task is this?',
  criteria: Object.fromEntries(TASK_SHAPES.map((shape) => [shape, SHAPE_MEANINGS[shape]])),
};

export function parseAnswerText(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().slice(0, max);
}
