import type { OnboardingCheck, OnboardingProjectChoice } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { OnboardingFailure, ProjectRevision } from '../schema.ts';
import type { SetupPatch, StepDefinition, StepReadContext } from '../steps/schema.ts';

export interface FlowContext extends StepReadContext {
  readonly save: (patch: SetupPatch, commandId: string) => Effect.Effect<void, OnboardingFailure>;
  readonly createProjects: (
    choices: OnboardingProjectChoice[] | undefined,
    commandId: string
  ) => Effect.Effect<void, OnboardingFailure>;
}

export interface FlowDefinition {
  readonly path: string;
  readonly steps: readonly StepDefinition[];
  readonly readOnly: boolean;
  readonly newId: Effect.Effect<string>;
  readonly resolveContext: (revision: ProjectRevision | null) => Effect.Effect<FlowContext>;
  readonly reviseProjects: (
    revision: ProjectRevision | null,
    text: string,
    choices: OnboardingProjectChoice[] | undefined
  ) => Effect.Effect<ProjectRevision, OnboardingFailure>;
  readonly isCompleted: Effect.Effect<boolean>;
  readonly complete: Effect.Effect<void, OnboardingFailure>;
  readonly requestHelp: (checks: OnboardingCheck[]) => Effect.Effect<string | null, OnboardingFailure>;
  readonly selectWelcome: Effect.Effect<string | null>;
}

const MAX_VALUES = 50;

const MAX_PROJECT_REPOS = 400;

export const ReplyType = Schema.Literals(['restart', 'open', 'help', 'answer', 'revise']);

export const AnswerValues = Schema.mutable(
  Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_VALUES))
);

export const ProjectChoices = Schema.mutable(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      repos: Schema.mutable(Schema.Array(Schema.String).check(Schema.isMaxLength(MAX_PROJECT_REPOS))),
    })
  ).check(Schema.isMaxLength(MAX_VALUES))
);
