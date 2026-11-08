import type {
  MessageKind,
  Project,
  ShinsaState,
  Task,
  TaskPriority,
  TaskShape,
  TaskSize,
  TeammateOriginal,
  TriageReasons,
  UnreachedTeammate,
} from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { JsonSchema } from '../agents/providers/index.ts';
import type { LocalRepo } from '../repos/index.ts';

export class ClassifierFailed extends Schema.TaggedError<
  ClassifierFailed,
  { readonly brand: unique symbol }
>()('ClassifierFailed', { message: Schema.String }) {}

export type QuickAsk = <T>(
  system: string,
  prompt: string,
  schema: JsonSchema
) => Effect.Effect<T | null, ClassifierFailed>;

export interface TriageResult {
  title: string;
  repoPath: string | null;
  newRepo?: string;
  size: TaskSize;
  branch: string;
  waitsOn: Task[];
  stacksOn?: Task[];
  duplicateOf?: string;
  duplicateOfTeammate?: TeammateOriginal;
  unreached?: UnreachedTeammate[];
  shape?: TaskShape;
  priority?: TaskPriority;
  reasons?: TriageReasons;
}

export type TriageResolver = (
  state: ShinsaState,
  task: Task,
  local: LocalRepo[]
) => Effect.Effect<TriageResult | null, ClassifierFailed>;

export interface MessageClass {
  kind: MessageKind;
  title: string | null;
  why: string | null;
  shape: TaskShape | null;
}

export type RepositoryFinder = (
  state: ShinsaState,
  task: Task,
  local: LocalRepo[]
) => Effect.Effect<string | null, ClassifierFailed>;

export interface CandidatePool {
  project: Project | null;
  candidates: LocalRepo[];
  named: LocalRepo[];
  empty: boolean;
  outside: string[];
}

export const NO_REPOSITORY = 'none';

export const REPOSITORY_RULE = `Never pick a repository only because it is the only one listed or because it was worked on recently; pick one when the request names it or clearly needs its code. "The repo", "the code" or "the project" alone names none. A request that names a repository that is not listed gets "${NO_REPOSITORY}".`;

export const UNDELIVERED_REASON = 'Shinsa could not deliver it. Send it again.';
