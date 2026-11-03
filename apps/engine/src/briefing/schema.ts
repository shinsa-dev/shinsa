import { BRIEFING_LIMITS, type ShinsaState } from '@shinsa/core';
import { Duration, Schema } from 'effect';
import type { Effect } from 'effect';
import type { JsonSchema } from '../agents/providers/index.ts';
import type { QuickJson } from '../agents/quick/index.ts';
import type { WrittenBriefing } from '../runtime/engine/schema.ts';

export interface BriefingOptions {
  ask: QuickJson;
  debounceMs?: number;
}

export class BriefingAskFailed extends Schema.TaggedError<
  BriefingAskFailed,
  { readonly brand: unique symbol }
>()('BriefingAskFailed', { message: Schema.String }) {}

export class BriefingWriteFailed extends Schema.TaggedError<
  BriefingWriteFailed,
  { readonly brand: unique symbol }
>()('BriefingWriteFailed', { message: Schema.String }) {}

export type BriefingAsk = (
  system: string,
  prompt: string,
  schema: JsonSchema
) => Effect.Effect<unknown, BriefingAskFailed>;

export interface BriefingsDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly ask: BriefingAsk;
  readonly write: (
    projectId: string | null,
    written: WrittenBriefing
  ) => Effect.Effect<void, BriefingWriteFailed>;
  readonly debounce: Duration.Duration;
}

export interface BriefingsHandle {
  readonly schedule: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}

export const BRIEFING_DEBOUNCE = Duration.seconds(4);

export const HOUR_MS = 60 * 60 * 1000;

export const BRIEFING_SYSTEM = [
  "You write the guide at the top of a developer's work queue in Shinsa.",
  'Agents do all the work. The developer only decides at gates: approve a plan, review finished changes, merge a clean pull request, answer a question, or decide what to do with paused work.',
  'From the decisions listed, pick the one to do now and the ones that follow.',
  'Return {"now": {"task": string, "why": string}, "next": [{"task": string, "why": string}], "note": string | null}.',
  'task: one option of the task field at the end of the prompt, copied exactly. next holds up to three other decisions in the order to take them, never the one in now.',
  'Keep the listed order unless a decision clearly unblocks other tasks or an agent is waiting on an answer; then that one goes first.',
  'Low priority decisions always come after every other decision, and one is never now while anything else is listed: they are finished, not urgent.',
  `why: one plain sentence of at most ${BRIEFING_LIMITS.why} characters on why this decision, and why at this point. It sits under the task title, so do not repeat the title.`,
  'Use only the facts given. Each decision says what it is: a review is built and checked and ready for review, not ready to merge. Say ready to merge only for a merge decision. A plan is not built yet.',
  'Never cite a pull request number, a repository or a branch: the task link shows them on hover. Say "the pull request is ready" instead.',
  'Refer to other tasks by their titles in quotes. Never by number, position or id: no "item three", no "the first one", and never write an id outside the task field.',
  `note: one heads-up sentence of at most ${BRIEFING_LIMITS.note} characters, only when something needs attention beyond the order: a paused task, a decision that has waited for days, work waiting on another task. Otherwise null.`,
  'The note must never name or describe a task that is in now or next: the guide already says why each of those matters, so put that in its why. If the only heads-up is about one of them, the note is null.',
  'Write whole sentences to the developer, not notes. Good why: "It has waited a day, and approving it lets the agent start on “Let the chat call tools”." Good note, about a decision not in now or next: "“Stop the preview flashing” is paused because the agent could not reproduce the flash."',
  'Plain, calm and specific. Sentence case, no greeting, no emoji, no em dashes, no exclamation marks.',
].join('\n');
