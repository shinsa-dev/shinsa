import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { JsonSchema } from '../../agents/providers/index.ts';
import type { OnboardingFailure } from '../schema.ts';

export type RevisionAsk = (
  system: string,
  prompt: string,
  schema: JsonSchema
) => Effect.Effect<unknown, OnboardingFailure>;

export const RevisionAnswer = Schema.Struct({
  reply: Schema.String,
  projects: Schema.Array(Schema.Struct({ name: Schema.String, repos: Schema.Array(Schema.Unknown) })),
});
export type RevisionAnswer = typeof RevisionAnswer.Type;

export const MAX_TURNS = 10;

export const REPLY_LIMIT = 300;

export const REVISE_SYSTEM = [
  'You sort a person’s code repositories into projects while they set up Shinsa, a tool that runs coding agents.',
  'You get the projects as they stand, every repository by id, and what the person asks for.',
  'Return the whole new list of projects, each with a short name and the ids of its repositories.',
  'Change only what the request asks for and keep every other project and repository as it is.',
  'A repository belongs to at most one project. Leave one out only when the request says so.',
  'In reply, tell the person in one short sentence what you changed, or why you could not.',
].join('\n');

export const REVISE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          repos: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'repos'],
      },
    },
  },
  required: ['reply', 'projects'],
};
