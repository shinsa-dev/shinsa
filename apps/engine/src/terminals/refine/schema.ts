import type { ServiceSuggestion } from '@shinsa/core';
import { type Effect, Schema } from 'effect';
import type { JsonSchema } from '../../agents/providers/index.ts';

export class ServiceRefineFailed extends Schema.TaggedError<
  ServiceRefineFailed,
  { readonly brand: unique symbol }
>()('ServiceRefineFailed', { message: Schema.String }) {}

type RefineAnswer = Effect.Effect<ServiceSuggestion[] | null, ServiceRefineFailed>;

export interface CachedRefinement {
  fingerprint: string;
  answer: RefineAnswer;
}

export const REFINE_SYSTEM = [
  'You set up the services of a software project: the commands a developer keeps running while they work, such as a web dev server, an API or a worker.',
  'You are given candidates a file scan found, each with its index, folder, command and source, and for each folder its package.json scripts and dependency names.',
  'Answer with one entry per candidate you have something to say about, by its index:',
  '- name: short and lower case, such as web, api, docs or worker; unique among the entries.',
  '- command: the candidate’s command, changed only where it must be. Every run gets a free port in the variable named by portVariable, so a server must listen on it: Next, Remix, Astro, Nuxt, Express and most Node servers read PORT themselves; Vite and Vite-based tools need `--port $PORT` (add `--` before it for npm run, as in `npm run dev -- --port $PORT`); a server that takes its port only as a flag gets that flag with $PORT.',
  '- previewUrl: for a server a person opens in a browser, its URL with {port} where the port goes, such as http://localhost:{port}; an empty string for anything else (a worker, a database, a library’s watcher, an API nobody opens).',
  '- portVariable: the variable the command reads its port from; an empty string for PORT.',
  '- recommended: true for an app or a server someone keeps running; false for a library’s build watcher, a script that runs every workspace at once, or anything that ends by itself.',
  'Never invent a command a candidate does not have. Leave out candidates you would not change.',
].join('\n');

export const REFINE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    services: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          name: { type: 'string' },
          command: { type: 'string' },
          previewUrl: { type: 'string' },
          portVariable: { type: 'string' },
          recommended: { type: 'boolean' },
        },
        required: ['index', 'name', 'command', 'previewUrl', 'portVariable', 'recommended'],
      },
    },
  },
  required: ['services'],
};
