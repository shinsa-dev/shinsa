import { listHeldSourceRequests, type Run, type Task, type WatchdogSpec } from '@shinsa/core';
import { resolveCommitType, serializeConventionalSubject } from '../git/index.ts';

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

export function assertProtocol<T>(result: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (result.ok) return result.value;
  throw new Error(
    `Shinsa rejected this hand-over. Fix these and call the tool again:\n${result.errors.map((error) => `- ${error}`).join('\n')}`
  );
}

export function assertHeldSourcesUsed(watchdogs: readonly WatchdogSpec[], serverNames: readonly string[]) {
  const errors = listHeldSourceRequests(watchdogs, serverNames);
  if (errors.length > 0) assertProtocol({ ok: false, errors });
}

export function resolveCommitMessage(task: Task, run: Run) {
  if (run.purpose !== 'build') return `fix: ${FIX_COMMIT[task.fixFor ?? 'you']}`;
  const step = task.plan?.document?.phases[run.phaseIndex ?? 0];
  return serializeConventionalSubject(resolveCommitType(task.branch), step?.title ?? task.title);
}
