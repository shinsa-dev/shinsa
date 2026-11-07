import type {
  AgentModel,
  OnboardingCheck,
  OnboardingChoiceGroup,
  OnboardingOption,
  OnboardingProjectChoice,
  OnboardingStepId,
  PlanApproval,
  ProjectSuggestion,
  RootSuggestions,
  Settings,
} from '@shinsa/core';
import { PLAN_SIZE_LIMITS } from '@shinsa/core';
import type { Effect } from 'effect';
import type { ClaudeAccount } from '../accounts.ts';
import type { OnboardingFailure, PrerequisiteReport } from '../schema.ts';

export interface SetupPatch {
  roots?: string[];
  defaultModel?: string | null;
  mergeMethod?: Settings['mergeMethod'];
  approvePlans?: PlanApproval;
}

export interface StepReadContext {
  readonly userHome: string;
  readonly settings: Settings;
  readonly roots: string[];
  readonly projectCount: number;
  readonly suggestRoots: Effect.Effect<RootSuggestions, OnboardingFailure>;
  readonly suggestProjects: Effect.Effect<ProjectSuggestion[], OnboardingFailure>;
  readonly listFiledProjects: Effect.Effect<ProjectSuggestion[]>;
  readonly listModels: Effect.Effect<AgentModel[], OnboardingFailure>;
  readonly listAccounts: Effect.Effect<ClaudeAccount[], OnboardingFailure>;
  readonly checkPrerequisites: Effect.Effect<PrerequisiteReport, OnboardingFailure>;
  readonly resolveRoots: (value: unknown) => Effect.Effect<string[], OnboardingFailure>;
}

interface StepContext extends StepReadContext {
  readonly save: (patch: SetupPatch) => Effect.Effect<void, OnboardingFailure>;
  readonly createProjects: (
    choices: OnboardingProjectChoice[] | undefined
  ) => Effect.Effect<void, OnboardingFailure>;
}

export interface StepView {
  title: string;
  description: string;
  multiple: boolean;
  options: OnboardingOption[];
  groups: OnboardingChoiceGroup[];
  projects: ProjectSuggestion[];
  filed: ProjectSuggestion[];
  checks: OnboardingCheck[];
  ready: boolean;
  submitLabel: string;
}

export interface StepDefinition {
  readonly id: OnboardingStepId;
  readonly label: string;
  readonly view: (
    context: StepReadContext,
    answered: boolean,
    picked: string[]
  ) => Effect.Effect<StepView, OnboardingFailure>;
  readonly summarize: (context: StepReadContext) => Effect.Effect<string | null, OnboardingFailure>;
  readonly answer: (
    values: string[],
    context: StepContext,
    projects?: OnboardingProjectChoice[]
  ) => Effect.Effect<void, OnboardingFailure>;
}

export const MAX_SUGGESTIONS = 8;

export const CONTINUE = 'continue';

export const ROLE_MODELS = ':roles';

export const RECOMMENDED_MERGE: Settings['mergeMethod'] = 'squash';

export const MERGE_OPTIONS: { value: Settings['mergeMethod']; label: string; detail: string }[] = [
  { value: 'squash', label: 'Squash', detail: 'Every pull request lands as one commit.' },
  { value: 'merge', label: 'Merge commit', detail: 'Every commit is kept, joined by a merge commit.' },
  {
    value: 'rebase',
    label: 'Rebase',
    detail: 'The commits are replayed onto the default branch, with no merge commit.',
  },
];

export const RECOMMENDED_PLANS: PlanApproval = 'large';

export const PLAN_OPTIONS: { value: PlanApproval; label: string; detail: string; summary: string }[] = [
  {
    value: 'large',
    label: 'Show me large plans first',
    detail: `Before building a plan with more than ${PLAN_SIZE_LIMITS.phases} phases or ${PLAN_SIZE_LIMITS.files} files, the agent waits for you to approve it.`,
    summary: 'Large plans first',
  },
  {
    value: 'always',
    label: 'Show me every plan first',
    detail: 'The agent waits for you to approve every plan before it builds.',
    summary: 'Every plan first',
  },
  {
    value: 'when_asked',
    label: 'Start building',
    detail: 'Agents plan on their own and show you a plan only when you ask for one.',
    summary: 'Start building',
  },
];
