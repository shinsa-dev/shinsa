import { SCHEDULE_LIMITS } from '@shinsa/core';
import { PROMPT_EMPTY, PROMPT_TOO_LONG } from './schema.ts';

export function resolvePromptProblem(prompt: string) {
  const length = prompt.trim().length;
  if (length === 0) return PROMPT_EMPTY;
  return length > SCHEDULE_LIMITS.prompt ? PROMPT_TOO_LONG : null;
}
