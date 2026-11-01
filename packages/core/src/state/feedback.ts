import { type Feedback, type FeedbackLeak, listFeedbackLeaks } from '../domain/feedback.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { removeEntry, writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';
import { record } from './write.ts';

type FeedbackEvent = Extract<ShinsaEvent, { type: 'feedback.recorded' | 'feedback.removed' }>;

function applyRecorded(state: ShinsaState, event: EventOf<'feedback.recorded'>) {
  const isNew = !state.feedback[event.entry.id];
  writeEntry(state, 'feedback', event.entry.id, event.entry);
  if (!isNew || event.entry.source !== 'agent' || !event.entry.taskId) return;
  record(state, event.entry.taskId, event.at, {
    actor: 'agent',
    kind: 'suggestion',
    text: 'Reported feedback on Shinsa',
    detail: event.entry.note,
    runId: event.entry.runId,
  });
}

export function applyFeedbackEvent(state: ShinsaState, event: FeedbackEvent) {
  switch (event.type) {
    case 'feedback.recorded':
      applyRecorded(state, event);
      return;
    case 'feedback.removed':
      removeEntry(state, 'feedback', event.feedbackId);
      return;
  }
}

function compareFeedback(left: Feedback, right: Feedback) {
  return right.createdAt - left.createdAt || left.id.localeCompare(right.id);
}

export function listFeedback(state: ShinsaState): Feedback[] {
  return Object.values(state.feedback).sort(compareFeedback);
}

function listHomeNames(path: string) {
  return [...path.matchAll(/(?:^|[/\\])(?:Users|home)[/\\]([^/\\]+)/g)].flatMap((match) =>
    match[1] ? [match[1]] : []
  );
}

function listRemoteNames(remote: string | null) {
  if (!remote) return [];
  const match = remote.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match?.[1] && match[2] ? [match[1], match[2], `${match[1]}/${match[2]}`] : [];
}

function listPaths(paths: readonly (string | null | undefined)[]) {
  return paths.flatMap((path) => (path ? [path, ...listHomeNames(path)] : []));
}

export function listPrivateWords(state: ShinsaState): string[] {
  const words: string[] = [];
  for (const project of Object.values(state.projects)) {
    words.push(project.name, project.key, ...listPaths(project.folders));
  }
  for (const repo of Object.values(state.repos)) {
    words.push(repo.name, ...listPaths([repo.path]), ...listRemoteNames(repo.remote));
  }
  for (const task of Object.values(state.tasks)) {
    if (task.handle) words.push(task.handle);
    if (task.branch) words.push(task.branch);
    words.push(...listPaths([task.worktreePath]));
    if (task.account?.email) words.push(task.account.email);
  }
  for (const run of Object.values(state.runs)) {
    for (const account of [run.account, ...(run.attempts ?? []).map((attempt) => attempt.account)]) {
      if (account?.email) words.push(account.email);
    }
  }
  return [...new Set(words)];
}

export function resolveFeedbackIssueText(entry: Pick<Feedback, 'title' | 'body'>) {
  return `${entry.title ?? ''}\n\n${entry.body ?? ''}`;
}

export function listFeedbackEntryLeaks(
  state: ShinsaState,
  entry: Pick<Feedback, 'title' | 'body'>
): FeedbackLeak[] {
  return listFeedbackLeaks(resolveFeedbackIssueText(entry), listPrivateWords(state));
}
