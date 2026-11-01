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
import type { IconName } from '@shinsa/ui/components/icon';
import * as React from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { formatSince } from '@/lib/format/time.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';

export const FEEDBACK_ICON = 'IconMegaphone';

export const FEEDBACK_ACTIVE_ICON = 'IconMegaphoneFilled';

export const FEEDBACK_INTRO = {
  before: 'Your agent turns your note into a public GitHub issue on',
  after: ', without anything private. You read it before it opens under your GitHub account.',
};

export const FEEDBACK_HINT = 'Your agent turns it into a public GitHub issue that you read before it opens';

export const FEEDBACK_AGENTS_NOTE =
  'Agents report what gets in their way here too. Nothing they report opens until you open it.';

interface FeedbackView {
  openerId: string | null;
  selectedId: string | null;
}

const CLOSED: FeedbackView = { openerId: null, selectedId: null };

let view: FeedbackView = CLOSED;
const listeners = new Set<() => void>();
const openers = new Map<string, () => boolean>();

function replaceView(next: FeedbackView) {
  if (next.openerId === view.openerId && next.selectedId === view.selectedId) return;
  view = next;
  for (const listener of listeners) listener();
}

export function registerFeedbackOpener(openerId: string, isShown: () => boolean) {
  openers.set(openerId, isShown);
  return () => {
    openers.delete(openerId);
    if (view.openerId === openerId) replaceView({ ...view, openerId: null });
  };
}

export function updateFeedbackOpen(openerId: string, open: boolean) {
  if (open) replaceView({ ...view, openerId });
  else if (view.openerId === openerId) replaceView({ ...view, openerId: null });
}

export function openFeedback() {
  const shown = [...openers].find(([, isShown]) => isShown());
  if (shown) replaceView({ ...view, openerId: shown[0] });
}

export function openFeedbackEntry(feedbackId: string) {
  replaceView({ openerId: null, selectedId: feedbackId });
}

export function closeFeedbackEntry() {
  replaceView({ ...view, selectedId: null });
}

export function isFeedbackOpen() {
  return view.openerId !== null;
}

export function selectOpenFeedbackEntryId() {
  return view.selectedId;
}

export function resetFeedbackOpen() {
  view = CLOSED;
  openers.clear();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFeedbackOpen(openerId: string) {
  const isOpen = () => view.openerId === openerId;
  return React.useSyncExternalStore(subscribe, isOpen, isOpen);
}

export function useOpenFeedbackEntryId() {
  return React.useSyncExternalStore(subscribe, selectOpenFeedbackEntryId, selectOpenFeedbackEntryId);
}

export interface FeedbackGroups {
  waiting: Feedback[];
  filed: Feedback[];
}

export function listFeedbackGroups(state: ShinsaState): FeedbackGroups {
  const entries = listFeedback(state);
  return {
    waiting: entries.filter((entry) => entry.status !== 'filed'),
    filed: entries
      .filter((entry) => entry.status === 'filed')
      .sort((a, b) => Number(isFeedbackClosed(a)) - Number(isFeedbackClosed(b))),
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

export function isFeedbackClosed(entry: Feedback) {
  return entry.issue !== null && entry.issue.closedAt !== null;
}

export function resolveFeedbackFiledAt(entry: Feedback) {
  return entry.issue?.closedAt ?? entry.issue?.openedAt ?? entry.updatedAt;
}

export function describeFeedbackFiled(entry: Feedback, now: number) {
  return formatSince(isFeedbackClosed(entry) ? 'Closed' : 'Opened', resolveFeedbackFiledAt(entry), now);
}

export function describeFeedbackSender(entry: Feedback) {
  return entry.source === 'agent' ? 'From an agent' : 'From you';
}

export function describeFeedbackPreview(entry: Feedback) {
  return entry.title ?? entry.note;
}

export function describeFeedbackRowMeta(state: ShinsaState, entry: Feedback) {
  if (entry.status === 'drafting') return 'Your agent is drafting it';
  if (entry.status === 'filing') return 'Opening on GitHub';
  if (entry.status === 'failed') return 'Failed. Open it to see why';
  if (entry.source === 'human') return 'From you';
  const task = entry.taskId ? state.tasks[entry.taskId] : undefined;
  return task ? `From the agent on ${task.title}` : 'From an agent';
}

export type FeedbackRowIcon = { kind: 'busy' } | { kind: 'icon'; icon: IconName; tone: Tone };

export function resolveFeedbackRowIcon(state: ShinsaState, entry: Feedback): FeedbackRowIcon {
  if (entry.status === 'drafting' || entry.status === 'filing') return { kind: 'busy' };
  if (entry.status === 'failed') return { kind: 'icon', icon: 'IconExclamationTriangle', tone: 'red' };
  if (entry.status !== 'filed' && resolveFeedbackLeaks(state, entry) !== null)
    return { kind: 'icon', icon: 'IconExclamationTriangle', tone: 'amber' };
  return { kind: 'icon', icon: entry.source === 'agent' ? 'IconRobot' : 'IconUser', tone: 'neutral' };
}

export function resolveFeedbackSectionId(section: keyof FeedbackGroups) {
  return createDisclosureId('feedback', 'section', section);
}

export function describeFeedbackIssue(entry: Feedback) {
  return entry.issue ? `#${entry.issue.number}` : null;
}

export function resolveFeedbackLeaks(
  state: ShinsaState,
  text: Pick<Feedback, 'title' | 'body'>
): string | null {
  if (text.title === null || text.body === null) return null;
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
