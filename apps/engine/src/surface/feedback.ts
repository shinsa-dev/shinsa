import { FEEDBACK_REPOSITORY, type Feedback, type FeedbackLeak } from '@shinsa/core';
import type { FieldSpec } from './fields.ts';
import { defineCommand, defineRead, readValue, type SurfaceSpec } from './spec.ts';

type FeedbackView = Feedback & { task: string | null; leaks: FeedbackLeak[] };

const FEEDBACK_FIELD: FieldSpec = {
  name: 'feedback',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The feedback id, from `shinsa feedback list`.',
};

const STATUS_WORDS: Record<Feedback['status'], string> = {
  drafting: 'drafting',
  draft: 'waits for you',
  filing: 'opening',
  filed: 'open',
  failed: 'failed',
};

function describeSource(entry: FeedbackView) {
  if (entry.source === 'human') return 'from you';
  return entry.task ? `from an agent in ${entry.task}` : 'from an agent';
}

function describeFeedback(entry: FeedbackView) {
  const head = `${entry.id}  (${STATUS_WORDS[entry.status]}, ${describeSource(entry)}) ${entry.title ?? entry.note}`;
  const lines = [head];
  if (entry.issue) lines.push(`  ${entry.issue.url}`);
  if (entry.status === 'failed' && entry.failure) lines.push(`  ${entry.failure}`);
  if (entry.leaks.length > 0) {
    lines.push(`  Still private: ${entry.leaks.map((leak) => leak.text).join(', ')}`);
  }
  return lines.join('\n');
}

export const FEEDBACK_SPECS: SurfaceSpec[] = [
  defineRead<{ feedback: FeedbackView[] }>({
    path: ['feedback', 'list'],
    summary: `List feedback on Shinsa: the issues that wait for you to open them on ${FEEDBACK_REPOSITORY}, and the ones you opened.`,
    fields: [],
    request: () => '/api/feedback',
    format: ({ feedback }) =>
      feedback.length === 0 ? 'No feedback yet.' : feedback.map(describeFeedback).join('\n'),
  }),
  defineCommand({
    path: ['feedback', 'write'],
    summary:
      'Write feedback on Shinsa, or rewrite one with --id. Your agent drafts it as a public GitHub issue without anything private, and it waits for you to open it.',
    command: 'feedback.write',
    fields: [
      { name: 'id', kind: 'text', description: 'The feedback to rewrite. Leave out to write new feedback.' },
      {
        name: 'note',
        kind: 'text',
        positional: 'rest',
        required: true,
        description: 'What you want to tell Shinsa.',
      },
    ],
    build: (values) => ({
      type: 'feedback.write',
      feedbackId: readValue(values, 'id') || null,
      note: readValue(values, 'note'),
    }),
    done: () => 'Your agent is drafting the issue. Read it with `shinsa feedback list`.',
  }),
  defineCommand({
    path: ['feedback', 'edit'],
    summary: 'Change the title and description of a drafted issue before you open it.',
    command: 'feedback.update',
    fields: [
      FEEDBACK_FIELD,
      { name: 'title', kind: 'text', required: true, description: 'The issue’s title.' },
      { name: 'body', kind: 'text', required: true, description: 'The issue’s description, in markdown.' },
    ],
    build: (values) => ({
      type: 'feedback.update',
      feedbackId: readValue(values, 'feedback'),
      title: readValue(values, 'title'),
      body: readValue(values, 'body'),
    }),
    done: () => 'Changed.',
  }),
  defineCommand({
    path: ['feedback', 'file'],
    summary: `Open a drafted issue on ${FEEDBACK_REPOSITORY} with your GitHub login. Shinsa checks it for anything private first.`,
    command: 'feedback.file',
    humanOnly: true,
    fields: [FEEDBACK_FIELD],
    build: (values) => ({ type: 'feedback.file', feedbackId: readValue(values, 'feedback') }),
    done: () => 'Opening the issue on GitHub.',
  }),
  defineCommand({
    path: ['feedback', 'dismiss'],
    summary: 'Dismiss feedback that waits for you, without opening an issue.',
    command: 'feedback.dismiss',
    fields: [FEEDBACK_FIELD],
    build: (values) => ({ type: 'feedback.dismiss', feedbackId: readValue(values, 'feedback') }),
    done: () => 'Dismissed.',
  }),
];
