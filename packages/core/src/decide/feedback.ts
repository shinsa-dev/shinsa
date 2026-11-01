import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  FEEDBACK_LIMITS,
  type Feedback,
  type FeedbackLeak,
  isFeedbackFileable,
  resolveFeedbackText,
} from '../domain/index.ts';
import { listFeedback, listFeedbackEntryLeaks } from '../state/feedback.ts';
import type { Decider } from './decider.ts';
import { findCurrentRun } from './runs.ts';

const LEAK_NAMES: Record<FeedbackLeak['kind'], string> = {
  email: 'an email address',
  path: 'a home folder path',
  secret: 'what looks like a token or a key',
  url: 'a link outside Shinsa',
  private_word: 'a name from your projects',
};

function findFeedback(decider: Decider, feedbackId: string) {
  const entry = decider.state.feedback[feedbackId];
  if (!entry) throw new DomainError('feedback_not_found', `No feedback ${feedbackId}`);
  return entry;
}

function assertNote(note: string) {
  if (note.length === 0) throw new DomainError('feedback_invalid', 'Write what you want to tell Shinsa.');
  if (note.length > FEEDBACK_LIMITS.note) {
    throw new DomainError('feedback_invalid', `Feedback can be at most ${FEEDBACK_LIMITS.note} characters.`);
  }
}

function assertIssueText(title: string, body: string) {
  if (title.length === 0 || body.length === 0) {
    throw new DomainError('feedback_invalid', 'The issue needs a title and a description.');
  }
  if (title.length > FEEDBACK_LIMITS.title || body.length > FEEDBACK_LIMITS.body) {
    throw new DomainError(
      'feedback_invalid',
      `A title can be at most ${FEEDBACK_LIMITS.title} characters and a description ${FEEDBACK_LIMITS.body}.`
    );
  }
}

function assertNotBusy(entry: Feedback) {
  if (entry.status === 'drafting') {
    throw new DomainError('feedback_busy', 'Your agent is still writing this issue. Wait for the draft.');
  }
  if (entry.status === 'filing') {
    throw new DomainError('feedback_busy', 'This issue is being opened on GitHub. Wait for it to finish.');
  }
}

function assertHumanFiles(decider: Decider) {
  if (!decider.context.onBehalf) return;
  throw new DomainError(
    'human_only',
    'Only the human opens a public issue. Leave the draft for them to read.'
  );
}

export function describeFeedbackLeaks(leaks: readonly FeedbackLeak[]) {
  const quoted = leaks.map((leak) => `${LEAK_NAMES[leak.kind]} (“${leak.text}”)`);
  return `This issue still has ${quoted.join(', ')}. Take it out before you open the issue.`;
}

function draft(decider: Decider, entry: Feedback) {
  decider.emit({ type: 'feedback.recorded', entry });
  decider.run({ kind: 'feedback.draft', feedbackId: entry.id });
}

function createEntry(
  decider: Decider,
  patch: Pick<Feedback, 'source' | 'note' | 'taskId' | 'runId'>
): Feedback {
  return {
    id: decider.context.newId(),
    ...patch,
    title: null,
    body: null,
    status: 'drafting',
    failure: null,
    issue: null,
    createdAt: decider.context.now,
    updatedAt: decider.context.now,
  };
}

export function writeFeedback(decider: Decider, command: CommandOf<'feedback.write'>) {
  const note = resolveFeedbackText(command.note);
  assertNote(note);
  if (!command.feedbackId) {
    draft(decider, createEntry(decider, { source: 'human', note, taskId: null, runId: null }));
    return;
  }
  const entry = findFeedback(decider, command.feedbackId);
  assertNotBusy(entry);
  if (entry.status === 'filed')
    throw new DomainError('feedback_filed', 'This issue is already open on GitHub.');
  draft(decider, {
    ...entry,
    note,
    title: null,
    body: null,
    status: 'drafting',
    failure: null,
    updatedAt: decider.context.now,
  });
}

export function updateFeedback(decider: Decider, command: CommandOf<'feedback.update'>) {
  const entry = findFeedback(decider, command.feedbackId);
  if (!isFeedbackFileable(entry)) {
    throw new DomainError('feedback_not_draft', 'Only a draft that waits for you can be changed.');
  }
  const title = resolveFeedbackText(command.title);
  const body = resolveFeedbackText(command.body);
  assertIssueText(title, body);
  if (entry.status === 'draft' && entry.title === title && entry.body === body) return;
  decider.emit({
    type: 'feedback.recorded',
    entry: { ...entry, title, body, status: 'draft', failure: null, updatedAt: decider.context.now },
  });
}

export function fileFeedback(decider: Decider, command: CommandOf<'feedback.file'>) {
  assertHumanFiles(decider);
  const entry = findFeedback(decider, command.feedbackId);
  if (!isFeedbackFileable(entry)) {
    throw new DomainError('feedback_not_draft', 'Only a draft that waits for you can be opened as an issue.');
  }
  const leaks = listFeedbackEntryLeaks(decider.state, entry);
  if (leaks.length > 0) throw new DomainError('feedback_private', describeFeedbackLeaks(leaks));
  decider.emit({
    type: 'feedback.recorded',
    entry: { ...entry, status: 'filing', failure: null, updatedAt: decider.context.now },
  });
  decider.run({ kind: 'feedback.file', feedbackId: entry.id });
}

export function dismissFeedback(decider: Decider, command: CommandOf<'feedback.dismiss'>) {
  const entry = findFeedback(decider, command.feedbackId);
  if (entry.status === 'filing') {
    throw new DomainError('feedback_busy', 'This issue is being opened on GitHub. Wait for it to finish.');
  }
  decider.emit({ type: 'feedback.removed', feedbackId: entry.id });
}

function selectEntry(decider: Decider, feedbackId: string, status: Feedback['status']) {
  const entry = decider.state.feedback[feedbackId];
  return entry?.status === status ? entry : null;
}

export function recordFeedbackDraft(decider: Decider, command: CommandOf<'feedback.record_draft'>) {
  const entry = selectEntry(decider, command.feedbackId, 'drafting');
  if (!entry) return;
  const title = resolveFeedbackText(command.title).slice(0, FEEDBACK_LIMITS.title);
  const body = resolveFeedbackText(command.body).slice(0, FEEDBACK_LIMITS.body);
  if (title.length === 0 || body.length === 0) {
    recordFeedbackFailure(decider, {
      ...command,
      type: 'feedback.record_failure',
      detail: 'The draft came back empty.',
    });
    return;
  }
  decider.emit({
    type: 'feedback.recorded',
    entry: { ...entry, title, body, status: 'draft', updatedAt: decider.context.now },
  });
}

export function recordFeedbackFiled(decider: Decider, command: CommandOf<'feedback.record_filed'>) {
  const entry = selectEntry(decider, command.feedbackId, 'filing');
  if (!entry) return;
  decider.emit({
    type: 'feedback.recorded',
    entry: {
      ...entry,
      status: 'filed',
      issue: { number: command.number, url: command.url },
      updatedAt: decider.context.now,
    },
  });
}

export function recordFeedbackFailure(decider: Decider, command: CommandOf<'feedback.record_failure'>) {
  const entry = decider.state.feedback[command.feedbackId];
  if (!entry || (entry.status !== 'drafting' && entry.status !== 'filing')) return;
  decider.emit({
    type: 'feedback.recorded',
    entry: {
      ...entry,
      status: 'failed',
      failure: command.detail.slice(0, FEEDBACK_LIMITS.failure),
      updatedAt: decider.context.now,
    },
  });
}

function isKnownNote(decider: Decider, note: string) {
  const key = note.toLowerCase();
  return listFeedback(decider.state).some((entry) => entry.note.toLowerCase() === key);
}

function countAgentWaiting(decider: Decider) {
  return listFeedback(decider.state).filter((entry) => entry.source === 'agent' && entry.status !== 'filed')
    .length;
}

function countTaskReports(decider: Decider, taskId: string) {
  return listFeedback(decider.state).filter((entry) => entry.taskId === taskId).length;
}

export function reportFeedback(decider: Decider, command: CommandOf<'agent.report_feedback'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'report_feedback');
  const note = resolveFeedbackText(command.note);
  assertNote(note);
  if (isKnownNote(decider, note)) return;
  if (countTaskReports(decider, task.id) >= FEEDBACK_LIMITS.perTask) {
    throw new DomainError(
      'feedback_full',
      `This task already reported ${FEEDBACK_LIMITS.perTask} things about Shinsa. Leave this one and carry on with your step.`
    );
  }
  if (countAgentWaiting(decider) >= FEEDBACK_LIMITS.agentWaiting) {
    throw new DomainError(
      'feedback_full',
      `The human already has ${FEEDBACK_LIMITS.agentWaiting} reports to read. Leave this one and carry on with your step.`
    );
  }
  draft(decider, createEntry(decider, { source: 'agent', note, taskId: task.id, runId: run.id }));
}
