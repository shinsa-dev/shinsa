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
  context: readonly string[];
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
  'The issue must be detailed enough that a maintainer, or a coding agent that turns issues into tasks, can reproduce and fix it without asking a question. Never be vague: name the exact screen, button, command, step, gate or agent tool, the exact state the task was in, what Shinsa showed or did, and what it should have done instead. Carry over every concrete Shinsa detail the feedback gives, rewritten generically; never invent one it does not give.',
  `Write \`title\`, one sentence-case line of at most ${FEEDBACK_LIMITS.title} characters that names the specific problem or wish, never a vague one such as “Bug in tasks”.`,
  'Write `body` in GitHub markdown under these level 3 headings, always in this order and always all of them:',
  '`### Summary`: one or two sentences on the problem or wish.',
  '`### Where in Shinsa`: the screen, page, dialog, step, gate, setting, `shinsa` command or agent tool involved, and the state the task was in. Use the context lines given with the feedback.',
  '`### What happened`: what Shinsa did or showed, in detail, including any message it gave, rewritten without private details.',
  '`### What should happen`: the expected behaviour, precise enough to test.',
  '`### Steps to reproduce`: a numbered list from a generic starting point, such as “Open a task waiting for review”.',
  '`### Why it matters`: what it blocked, cost or made harder, and how often.',
  '`### Suggested change`: a concrete change to Shinsa, the screens or parts it touches.',
  '`### Acceptance criteria`: a markdown task list (`- [ ] …`) of two to five checks a fix must pass, each one observable.',
  'When the feedback gives nothing for a section, write “Not given in the feedback.” under its heading; never drop a heading. Never write an Environment section: Shinsa adds it.',
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
  return body.length > 0 && body.length <= FEEDBACK_LIMITS.draft ? body : null;
}

export function describeFeedbackPrompt(input: FeedbackDraftInput) {
  const words = input.privateWords.slice(0, PRIVATE_WORDS_LIMIT);
  return [
    SOURCE_LINES[input.source],
    `Private words: ${words.length > 0 ? words.join(', ') : 'none'}`,
    'Context:',
    ...input.context.map((line) => `- ${line}`),
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
