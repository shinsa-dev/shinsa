import type { Duration, Effect } from 'effect';
import { Schema } from 'effect';
import type { CompletionRequest, JsonSchema } from '../../types.ts';
import type { CodexExecutable } from '../executable/schema.ts';

export class CodexCallFailed extends Schema.TaggedError<CodexCallFailed, { readonly brand: unique symbol }>()(
  'CodexCallFailed',
  { message: Schema.String }
) {}

export interface CodexCallDefinition {
  readonly executable: Effect.Effect<CodexExecutable>;
  readonly env: Record<string, string | undefined> | undefined;
  readonly cwd: string;
  readonly request: CompletionRequest;
  readonly schema: JsonSchema | null;
  readonly timeout: Duration.Duration;
}

export type CodexCallEvent =
  | { readonly type: 'notification'; readonly method: string; readonly params: Record<string, unknown> }
  | { readonly type: 'exit'; readonly message: string };

export const TURN_FAILED = 'Codex stopped with an error.';
