import { Schema, SchemaTransformation } from 'effect';
import { identity } from 'effect/Function';
import type { JsonSchema } from '../../agents/providers/index.ts';

const DESCRIPTION_LIMIT = 400;

export const SHARE_DESCRIBE_SYSTEM = [
  'You describe one piece of work for people following it from a public status page: customers, issue subscribers, teammates.',
  'Write `description`: one or two plain sentences on the problem or request the work addresses and what will change for them.',
  'Write it fresh from the request; never copy it, never quote it, and never write it as an instruction.',
  'Leave out names of people, machines, repositories, branches, files, code, links, tokens and anything that looks secret.',
  'Plain words, sentence case, no em dashes, no headings, at most 300 characters.',
].join('\n');

export const SHARE_DESCRIBE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { description: { type: 'string' } },
  required: ['description'],
  additionalProperties: false,
};

const TidyLine = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(DESCRIPTION_LIMIT)),
    SchemaTransformation.transform({
      decode: (text) => text.trim().replace(/\s+/g, ' '),
      encode: identity,
    })
  )
);

export const ShareDescriptionAnswer = Schema.Struct({ description: TidyLine });
