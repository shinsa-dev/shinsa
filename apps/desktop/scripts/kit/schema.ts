import { Schema } from 'effect';

export class ScriptStepFailed extends Schema.TaggedError<
  ScriptStepFailed,
  { readonly brand: unique symbol }
>()('ScriptStepFailed', { message: Schema.String }) {}

export interface ScriptCommandOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

export const MARK_PATH = /<path d='([^']+)'/g;

export const PAGE_SLOTS = { marks: '<!-- marks -->', script: '<!-- script -->' } as const;

export const SCRIPT_CLOSE = /<\/script/gi;
