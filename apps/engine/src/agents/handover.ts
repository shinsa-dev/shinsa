import {
  listHeldSourceRequests,
  type Run,
  type Task,
  type Validation,
  type WatchdogSpec,
} from '@shinsa/core';
import { Result } from 'effect';
import { resolveCommitType, serializeConventionalSubject } from '../git/index.ts';
import { HandOverRejected } from './tools/schema.ts';

export const HANDED_OVER =
  'Handed over: the human reads it in the chat as your reply. Stop here and write nothing more: never point at it, repeat or summarise it, and never say your turn is over.';

const FIX_COMMIT: Record<NonNullable<Task['fixFor']>, string> = {
  checks: 'make the checks pass',
  review: 'address review findings',
  you: 'apply requested changes',
  pull_request: 'address pull request feedback',
  conflict: 'resolve conflicts',
  update: 'resolve conflicts with the base branch',
  hook: 'make the pre-push hook pass',
};

export function readString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function resolveHandOver<T>(validation: Validation<T>): Result.Result<T, HandOverRejected> {
  if (validation.ok) return Result.succeed(validation.value);
  const list = validation.errors.map((error) => `- ${error}`).join('\n');
  return Result.fail(
    new HandOverRejected({
      errors: validation.errors,
      message: `Shinsa rejected this hand-over. Fix these and call the tool again:\n${list}`,
    })
  );
}

export function assertHeldSourcesUsed(
  watchdogs: readonly WatchdogSpec[],
  serverNames: readonly string[]
): Result.Result<void, HandOverRejected> {
  const errors = listHeldSourceRequests(watchdogs, serverNames);
  return resolveHandOver<void>(errors.length > 0 ? { ok: false, errors } : { ok: true, value: undefined });
}

export function resolveCommitMessage(task: Task, run: Run) {
  if (run.purpose !== 'build') return `fix: ${FIX_COMMIT[task.fixFor ?? 'you']}`;
  const step = task.plan?.document?.phases[run.phaseIndex ?? 0];
  return serializeConventionalSubject(resolveCommitType(task.branch), step?.title ?? task.title);
}
