import {
  describeFeedbackLeaks,
  FEEDBACK_LIMITS,
  type Feedback,
  isFeedbackFileable,
  isFeedbackWaiting,
  listFeedback,
  listFeedbackEntryLeaks,
  type ShinsaState,
} from '@shinsa/core';
import * as React from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { formatSince } from '@/lib/format/time.ts';

export const FEEDBACK_ICON = 'IconMegaphone';

export const FEEDBACK_ACTIVE_ICON = 'IconMegaphoneFilled';

export const FEEDBACK_INTRO = {
  before: 'Your agent turns your note into a public GitHub issue on',
  after: ', without anything private. You read it before it opens under your GitHub account.',
};

export const FEEDBACK_HINT = 'Your agent turns it into a public GitHub issue that you read before it opens';

export const FEEDBACK_AGENTS_NOTE =
  'Agents report what gets in their way here too. Nothing they report opens until you open it.';

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function updateFeedbackOpen(next: boolean) {
  if (open === next) return;
  open = next;
  emit();
}

export function openFeedback() {
  updateFeedbackOpen(true);
}

export function isFeedbackOpen() {
  return open;
}

export function resetFeedbackOpen() {
  open = false;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFeedbackOpen() {
  return React.useSyncExternalStore(subscribe, isFeedbackOpen, isFeedbackOpen);
}

export interface FeedbackGroups {
  waiting: Feedback[];
  filed: Feedback[];
}

export function listFeedbackGroups(state: ShinsaState): FeedbackGroups {
  const entries = listFeedback(state);
  return {
    waiting: entries.filter((entry) => entry.status !== 'filed'),
    filed: entries.filter((entry) => entry.status === 'filed'),
  };
}

export function countFeedbackWaiting(state: ShinsaState) {
  return listFeedback(state).filter(isFeedbackWaiting).length;
}

export function describeFeedbackCount(count: number) {
  return count === 0 ? null : String(count);
}

export function describeFeedbackSource(state: ShinsaState, entry: Feedback) {
  if (entry.source === 'human') return { label: 'From you', task: null };
  const task = entry.taskId ? (state.tasks[entry.taskId] ?? null) : null;
  return { label: task ? 'From the agent on' : 'From an agent', task };
}

export function describeFeedbackStatus(entry: Feedback) {
  switch (entry.status) {
    case 'drafting':
      return 'Your agent is drafting the issue.';
    case 'filing':
      return 'Opening the issue on GitHub.';
    case 'failed':
      return entry.failure ?? 'Something went wrong. Try again.';
    default:
      return null;
  }
}

export function describeFeedbackFiled(entry: Feedback, now: number) {
  const opened = formatSince('Opened', entry.updatedAt, now);
  return entry.source === 'agent' ? `${opened} from an agent’s report` : opened;
}

export function describeFeedbackIssue(entry: Feedback) {
  return entry.issue ? `#${entry.issue.number}` : null;
}

export function resolveFeedbackLeaks(
  state: ShinsaState,
  text: Pick<Feedback, 'title' | 'body'>
): string | null {
  const leaks = listFeedbackEntryLeaks(state, text);
  return leaks.length > 0 ? describeFeedbackLeaks(leaks) : null;
}

export function canOpenFeedback(entry: Feedback) {
  return isFeedbackFileable(entry);
}

export function needsRedraft(entry: Feedback) {
  return entry.status === 'failed' && (entry.title === null || entry.body === null);
}

export function validateFeedbackNote(note: string) {
  const length = note.trim().length;
  if (length === 0) return 'Write what you want to tell Shinsa.';
  if (length > FEEDBACK_LIMITS.note)
    return `Keep it to ${FEEDBACK_LIMITS.note} characters. It has ${length}.`;
  return null;
}

export function validateFeedbackIssue(title: string, body: string) {
  if (title.trim().length === 0 || body.trim().length === 0)
    return 'The issue needs a title and a description.';
  if (title.trim().length > FEEDBACK_LIMITS.title)
    return `Keep the title to ${FEEDBACK_LIMITS.title} characters.`;
  if (body.trim().length > FEEDBACK_LIMITS.body)
    return `Keep the description to ${FEEDBACK_LIMITS.body} characters.`;
  return null;
}

export interface FeedbackActions {
  write: (feedbackId: string | null, note: string) => Promise<boolean>;
  update: (entry: Feedback, title: string, body: string) => Promise<boolean>;
  file: (entry: Feedback) => Promise<boolean>;
  dismiss: (entry: Feedback) => Promise<boolean>;
}

export const FEEDBACK_ACTIONS: FeedbackActions = {
  write: (feedbackId, note) =>
    sendCommandWithToast({ type: 'feedback.write', feedbackId, note }, 'Your agent is drafting the issue.'),
  update: (entry, title, body) =>
    sendCommandWithToast({ type: 'feedback.update', feedbackId: entry.id, title, body }, 'Issue changed.'),
  file: (entry) =>
    sendCommandWithToast({ type: 'feedback.file', feedbackId: entry.id }, 'Opening the issue on GitHub.'),
  dismiss: (entry) => sendCommandWithToast({ type: 'feedback.dismiss', feedbackId: entry.id }, 'Dismissed.'),
};
