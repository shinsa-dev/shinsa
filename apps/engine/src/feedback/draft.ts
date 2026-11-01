import { FEEDBACK_LIMITS, FEEDBACK_REPOSITORY, type FeedbackSource } from '@shinsa/core';
import type { JsonSchema } from '../agents/providers/index.ts';
import type { QuickJson } from '../agents/quick/index.ts';

interface FeedbackDraft {
  title: string;
  body: string;
}

export interface FeedbackDraftInput {
  source: FeedbackSource;
  note: string;
  privateWords: readonly string[];
}

export type FeedbackDrafter = (input: FeedbackDraftInput) => Promise<FeedbackDraft | null>;

const PRIVATE_WORDS_LIMIT = 200;

const SYSTEM = [
  'You rewrite one piece of feedback on Shinsa, a control plane for coding agents, as a GitHub issue.',
  `The issue is public: anyone can read it on ${FEEDBACK_REPOSITORY}. Keeping the person who sent it private comes before everything else.`,
  'Describe only what Shinsa did and what should change, in terms any Shinsa user would recognize: its screens, buttons, commands, steps, gates, settings and agent tools.',
  'Never write a project, repository, file, folder, branch, task title, task handle, person, company, email, account, URL, code, command output, token, key or number that identifies them. Replace each with a generic word, such as “a repository” or “a task”.',
  'Never quote the feedback. Leave out anything that is not about Shinsa itself.',
  'Never write any of the private words listed with the feedback, in any form.',
  'The issue must be detailed enough that a maintainer who never saw the feedback can reproduce and fix it without asking a question. Never be vague: name the exact screen, button, command, step, gate or agent tool, the exact state the task was in, what Shinsa showed or did, and what it should have done instead. Carry over every concrete Shinsa detail the feedback gives, rewritten generically; never invent one it does not give.',
  `Write \`title\`, one sentence-case line of at most ${FEEDBACK_LIMITS.title} characters that names the specific problem or wish, never a vague one such as “Bug in tasks”.`,
  'Write `body` in GitHub markdown under these level 3 headings, in order: `### What happened` (what Shinsa did, where, and in which state), `### What should happen` (the expected behaviour), `### Steps to reproduce` (a numbered list from a generic starting point; write “Not given in the feedback.” when it gives none), `### Why it matters` (what it blocked or cost), and `### Suggested change` (a concrete change to Shinsa, only when the feedback implies one; leave the heading out otherwise).',
  'Plain words, complete sentences, no em dashes, no headings other than these.',
].join('\n');

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: { title: { type: 'string' }, body: { type: 'string' } },
  required: ['title', 'body'],
  additionalProperties: false,
};

const SOURCE_LINES: Record<FeedbackSource, string> = {
  human: 'From: the person using Shinsa, through its feedback button.',
  agent: 'From: a coding agent working in Shinsa, about something Shinsa did in its way.',
};

function readTitle(value: unknown) {
  if (typeof value !== 'string') return null;
  const line = value.trim().split('\n', 1)[0]?.trim() ?? '';
  return line.length > 0 && line.length <= FEEDBACK_LIMITS.title ? line : null;
}

function readBody(value: unknown) {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  return body.length > 0 && body.length <= FEEDBACK_LIMITS.body ? body : null;
}

export function describeFeedbackPrompt(input: FeedbackDraftInput) {
  const words = input.privateWords.slice(0, PRIVATE_WORDS_LIMIT);
  return [
    SOURCE_LINES[input.source],
    `Private words: ${words.length > 0 ? words.join(', ') : 'none'}`,
    'Feedback:',
    input.note,
  ].join('\n');
}

export function createFeedbackDrafter(ask: QuickJson): FeedbackDrafter {
  return async (input) => {
    const answer = await ask<{ title?: unknown; body?: unknown }>(
      SYSTEM,
      describeFeedbackPrompt(input),
      SCHEMA
    );
    const title = readTitle(answer?.title);
    const body = readBody(answer?.body);
    return title && body ? { title, body } : null;
  };
}
