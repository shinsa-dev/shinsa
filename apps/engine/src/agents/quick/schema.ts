import type { FastModeAvailability } from '@shinsa/core';
import { Context, type Effect, Schema } from 'effect';
import type { JsonSchema } from '../providers/index.ts';

export type QuickJson = <T>(system: string, prompt: string, schema?: JsonSchema) => Effect.Effect<T | null>;

export type QuickMode = 'structured' | 'text';

export interface QuickFailure {
  provider: string;
  mode: QuickMode;
  reason: string;
}

export interface QuickResult<T> {
  value: T | null;
  failures: QuickFailure[];
}

export type FastModeReader = (provider: string) => Effect.Effect<FastModeAvailability>;

export const QuickFastMode = Context.Reference<FastModeReader | null>(
  'shinsa/engine/agents/quick/QuickFastMode',
  {
    defaultValue: () => null,
  }
);

export interface QuickRequest<T> {
  task: string;
  system: string;
  prompt: string;
  schema: JsonSchema | null;
  parse: (value: unknown) => T | null;
  model: string | ((provider: string) => string);
  timeoutMs?: number;
  fastMode?: boolean;
  readFastMode?: FastModeReader;
}

export type QuickRole = 'classifier' | 'writer';

export class QuickAttemptFailed extends Schema.TaggedError<
  QuickAttemptFailed,
  { readonly brand: unique symbol }
>()('QuickAttemptFailed', {
  provider: Schema.String,
  mode: Schema.Literals(['structured', 'text']),
  reason: Schema.String,
}) {}

export const JSON_ONLY = 'Answer with one JSON object and nothing else.';

export const QUICK_MARKER = 'SHINSA_QUICK';

export const QUICK_OFF = 'off';

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface ChoicesQuestion {
  type: 'choices';
  instructions: string;
  criteria: Record<string, string>;
}

export type DecisionQuestion = ChoiceQuestion | ChoicesQuestion;
