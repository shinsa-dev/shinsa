import { splitMessageAttachments, type Task } from '@shinsa/core';
import type { JsonSchema } from '../agents/providers/index.ts';
import type { QuickJson } from '../agents/quick/index.ts';

export type ShareDescriber = (task: Task) => Promise<string | null>;

const DESCRIPTION_LIMIT = 400;

const SYSTEM = [
  'You describe one piece of work for people following it from a public status page: customers, issue subscribers, teammates.',
  'Write `description`: one or two plain sentences on the problem or request the work addresses and what will change for them.',
  'Write it fresh from the request; never copy it, never quote it, and never write it as an instruction.',
  'Leave out names of people, machines, repositories, branches, files, code, links, tokens and anything that looks secret.',
  'Plain words, sentence case, no em dashes, no headings, at most 300 characters.',
].join('\n');

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: { description: { type: 'string' } },
  required: ['description'],
  additionalProperties: false,
};

export function describeSharePrompt(task: Task) {
  return [`Title: ${task.title}`, `Request:\n${splitMessageAttachments(task.request).text}`].join('\n');
}

function readDescription(value: unknown) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > 0 && text.length <= DESCRIPTION_LIMIT ? text : null;
}

export function createShareDescriber(ask: QuickJson): ShareDescriber {
  return async (task) => {
    const answer = await ask<{ description?: unknown }>(SYSTEM, describeSharePrompt(task), SCHEMA);
    return readDescription(answer?.description);
  };
}
