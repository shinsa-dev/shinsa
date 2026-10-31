import {
  type AgentModel,
  DomainError,
  describeList,
  type OnboardingCheck,
  type OnboardingChoiceGroup,
  type OnboardingChoiceGroupId,
  type OnboardingOption,
  type OnboardingProjectChoice,
  type OnboardingStepId,
  PLAN_SIZE_LIMITS,
  type PlanApproval,
  type ProjectSuggestion,
  parseChoiceValue,
  type RootSuggestions,
  resolveDisplayPath,
  resolveModelLabel,
  type Settings,
  serializeChoiceValue,
} from '@shinsa/core';
import type { AccountSource, ClaudeAccount } from './accounts.ts';
import type { PrerequisiteReport } from './prerequisites.ts';
import { resolveChosenRoots } from './roots.ts';

export interface SetupPatch {
  roots?: string[];
  defaultModel?: string | null;
  mergeMethod?: Settings['mergeMethod'];
  approvePlans?: PlanApproval;
}

interface StepContext {
  userHome: string;
  settings: Settings;
  roots: string[];
  projectCount: number;
  suggestRoots: () => Promise<RootSuggestions>;
  suggestProjects: () => Promise<ProjectSuggestion[]>;
  listFiledProjects: () => ProjectSuggestion[];
  listModels: () => Promise<AgentModel[]>;
  listAccounts: AccountSource;
  checkPrerequisites: () => Promise<PrerequisiteReport>;
  save: (patch: SetupPatch) => Promise<void>;
  createProjects: (choices: OnboardingProjectChoice[] | undefined) => Promise<void>;
}

export type StepReadContext = Omit<StepContext, 'save' | 'createProjects'>;

interface StepView {
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
  id: OnboardingStepId;
  label: string;
  view: (context: StepReadContext, answered: boolean, picked: string[]) => Promise<StepView>;
  summarize: (context: StepReadContext) => Promise<string | null>;
  answer: (values: string[], context: StepContext, projects?: OnboardingProjectChoice[]) => Promise<void>;
}

const MAX_SUGGESTIONS = 8;

const CONTINUE = 'continue';

const ROLE_MODELS = ':roles';

function createOption(
  value: string,
  label: string,
  detail: string | null,
  chosen = false,
  recommended = false
): OnboardingOption {
  return { value, label, detail, chosen, recommended };
}

function createView(view: Partial<StepView> & Pick<StepView, 'title' | 'description'>): StepView {
  return {
    multiple: false,
    options: [],
    groups: [],
    projects: [],
    filed: [],
    checks: [],
    ready: true,
    submitLabel: 'Continue',
    ...view,
  };
}

function describeRepoCount(count: number) {
  return count === 1 ? '1 repository' : `${count} repositories`;
}

function assertContinue(values: string[]) {
  if (values.length !== 1 || values[0] !== CONTINUE) {
    throw new DomainError('answer_invalid', 'Continue to the next step.');
  }
}

const ROOTS: StepDefinition = {
  id: 'roots',
  label: 'Folders',
  view: async (context, _answered, picked) => {
    const { suggestions } = await context.suggestRoots();
    const configured = new Set(picked.length > 0 ? picked : context.roots);
    const options = suggestions
      .slice(0, MAX_SUGGESTIONS)
      .map((suggestion, index) =>
        createOption(
          suggestion.path,
          resolveDisplayPath(suggestion.path, context.userHome),
          describeRepoCount(suggestion.repoCount),
          configured.has(suggestion.path) || (configured.size === 0 && index === 0)
        )
      );
    for (const path of configured) {
      if (!options.some((option) => option.value === path)) {
        options.push(createOption(path, resolveDisplayPath(path, context.userHome), null, true));
      }
    }
    return createView({
      title: 'Where do you keep your repositories?',
      description:
        options.length > 0
          ? 'Shinsa looks for a task’s repository in the folders you pick. Add any other folder by its path.'
          : 'Shinsa found no repositories in your home folder. Add each folder that holds them by its path.',
      multiple: true,
      options,
    });
  },
  summarize: (context) => {
    const [first = null, ...rest] = context.roots.map((root) => resolveDisplayPath(root, context.userHome));
    return Promise.resolve(rest.length === 0 ? first : `${first} and ${rest.length} more`);
  },
  answer: async (values, context) => {
    await context.save({ roots: resolveChosenRoots(values, context.userHome) });
  },
};

function describeProjectCount(count: number) {
  return count === 1 ? '1 project' : `${count} projects`;
}

const PROJECTS: StepDefinition = {
  id: 'projects',
  label: 'Projects',
  view: async (context) => {
    const projects = await context.suggestProjects();
    const filed = context.listFiledProjects();
    if (projects.length === 0) {
      return createView({
        title: 'Your projects',
        description:
          filed.length > 0
            ? 'Shinsa set these up from your folders. Change them any time in Settings.'
            : 'Shinsa found no repositories in these folders yet. It files each one in a project the first time it works there.',
        filed,
      });
    }
    return createView({
      title: 'Shinsa sorted your repositories into projects',
      description:
        'Grouped by GitHub owner and folder. Rename or leave out what you do not want, or ask for a change in your own words.',
      projects,
      filed,
      submitLabel: projects.length === 1 ? 'Create the project' : `Create ${projects.length} projects`,
    });
  },
  summarize: (context) =>
    Promise.resolve(context.projectCount === 0 ? null : describeProjectCount(context.projectCount)),
  answer: async (values, context, projects) => {
    assertContinue(values);
    await context.createProjects(projects);
  },
};

function resolveModelMeaning(model: AgentModel) {
  const [, meaning] = model.description.split(' · ');
  return meaning ?? (model.description || null);
}

function createChoice(
  group: OnboardingChoiceGroupId,
  value: string,
  label: string,
  detail: string | null,
  picked: string,
  recommended = false
) {
  return createOption(serializeChoiceValue(group, value), label, detail, picked === value, recommended);
}

async function listModelChoices(context: StepReadContext) {
  const models = await context.listModels();
  const current = context.settings.defaultModel;
  const picked = current ?? ROLE_MODELS;
  const options = models.map((model) =>
    createChoice('model', model.id, model.label, resolveModelMeaning(model), picked, model.id === current)
  );
  if (current && !models.some((model) => model.id === current)) {
    options.unshift(createChoice('model', current, resolveModelLabel(current), null, picked, true));
  }
  options.push(
    createChoice(
      'model',
      ROLE_MODELS,
      'Each role’s own model',
      'Planning, building and review each start on the model Shinsa picks for that role.',
      picked
    )
  );
  return options;
}

const RECOMMENDED_MERGE: Settings['mergeMethod'] = 'squash';

const MERGE_OPTIONS: { value: Settings['mergeMethod']; label: string; detail: string }[] = [
  { value: 'squash', label: 'Squash', detail: 'Every pull request lands as one commit.' },
  { value: 'merge', label: 'Merge commit', detail: 'Every commit is kept, joined by a merge commit.' },
  {
    value: 'rebase',
    label: 'Rebase',
    detail: 'The commits are replayed onto the default branch, with no merge commit.',
  },
];

function listMergeChoices(context: StepReadContext, answered: boolean) {
  const picked = answered ? context.settings.mergeMethod : RECOMMENDED_MERGE;
  return MERGE_OPTIONS.map((option) =>
    createChoice(
      'merge',
      option.value,
      option.label,
      option.detail,
      picked,
      option.value === RECOMMENDED_MERGE
    )
  );
}

const RECOMMENDED_PLANS: PlanApproval = 'large';

const PLAN_OPTIONS: { value: PlanApproval; label: string; detail: string; summary: string }[] = [
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

function listPlanChoices(context: StepReadContext, answered: boolean) {
  const picked = answered ? (context.settings.approvePlans ?? 'when_asked') : RECOMMENDED_PLANS;
  return PLAN_OPTIONS.map((option) =>
    createChoice(
      'plans',
      option.value,
      option.label,
      option.detail,
      picked,
      option.value === RECOMMENDED_PLANS
    )
  );
}

function resolvePlanLabel(approval: PlanApproval | undefined) {
  return PLAN_OPTIONS.find((option) => option.value === (approval ?? 'when_asked'))?.summary as string;
}

async function listDefaultGroups(
  context: StepReadContext,
  answered: boolean
): Promise<OnboardingChoiceGroup[]> {
  return [
    { id: 'model', label: 'Model', options: await listModelChoices(context) },
    { id: 'merge', label: 'Merging', options: listMergeChoices(context, answered) },
    { id: 'plans', label: 'Plans', options: listPlanChoices(context, answered) },
  ];
}

function findGroupValue(group: OnboardingChoiceGroup, values: string[]) {
  const picks = values.filter((value) => parseChoiceValue(value)?.group === group.id);
  const option = group.options.find((entry) => entry.value === picks[0]);
  if (picks.length !== 1 || !option) {
    const labels = group.options.map((entry) => entry.label);
    throw new DomainError(
      'answer_invalid',
      `Pick one ${group.label.toLowerCase()} option: ${describeList(labels, 'or')}.`
    );
  }
  return parseChoiceValue(option.value)?.value as string;
}

function resolveMergeLabel(method: Settings['mergeMethod']) {
  return MERGE_OPTIONS.find((option) => option.value === method)?.label as string;
}

const DEFAULTS: StepDefinition = {
  id: 'defaults',
  label: 'Defaults',
  view: async (context, answered) =>
    createView({
      title: 'How should agents work?',
      description:
        'The recommended choices are picked. Continue to keep them; you can change any of them in Settings.',
      groups: await listDefaultGroups(context, answered),
    }),
  summarize: (context) => {
    const { defaultModel, mergeMethod, approvePlans } = context.settings;
    const parts = [
      defaultModel ? resolveModelLabel(defaultModel) : 'Each role’s own model',
      resolveMergeLabel(mergeMethod),
      resolvePlanLabel(approvePlans),
    ];
    return Promise.resolve(parts.join(' · '));
  },
  answer: async (values, context) => {
    const [model, merge, plans] = (await listDefaultGroups(context, false)).map((group) =>
      findGroupValue(group, values)
    );
    await context.save({
      defaultModel: model === ROLE_MODELS ? null : (model as string),
      mergeMethod: merge as Settings['mergeMethod'],
      approvePlans: plans as PlanApproval,
    });
  },
};

function describeAccountCount(accounts: ClaudeAccount[]) {
  if (accounts.length === 0) return 'None yet';
  return accounts.length === 1 ? '1 account' : `${accounts.length} accounts`;
}

function describeAccountsStep(installed: boolean, signedIn: boolean) {
  if (!installed)
    return 'Agents run on Claude Code. Install it here, then sign in to the Claude account agents work under.';
  if (signedIn) {
    return 'Agents work under these Claude accounts. When one runs out of usage, Shinsa moves the work to the next.';
  }
  return 'Sign in to the Claude account agents work under. You can add more accounts later in Settings.';
}

const ACCOUNTS: StepDefinition = {
  id: 'accounts',
  label: 'Claude',
  view: async (context) => {
    const [accounts, report] = await Promise.all([context.listAccounts(), context.checkPrerequisites()]);
    const checks = report.checks.filter((check) => check.id === 'claude');
    const installed = checks.every((check) => check.ok);
    const signedIn = accounts.some((account) => account.signedIn);
    return createView({
      title: 'Sign in with Claude',
      description: describeAccountsStep(installed, signedIn),
      checks,
      ready: installed,
      submitLabel: signedIn ? 'Continue' : 'Skip for now',
    });
  },
  summarize: async (context) => describeAccountCount(await context.listAccounts()),
  answer: (values) => {
    assertContinue(values);
    return Promise.resolve();
  },
};

const PREREQUISITES: StepDefinition = {
  id: 'prerequisites',
  label: 'Tools',
  view: async (context) => {
    const report = await context.checkPrerequisites();
    return createView({
      title: 'The tools Shinsa runs',
      description: report.ready
        ? 'Everything Shinsa needs is installed on this machine.'
        : 'Some tools are missing. Install each one here, or ask an agent for help when an install fails.',
      checks: report.checks,
      ready: report.ready,
      submitLabel: report.ready ? 'Finish setup' : 'Finish anyway',
    });
  },
  summarize: () => Promise.resolve(null),
  answer: (values) => {
    assertContinue(values);
    return Promise.resolve();
  },
};

export const ONBOARDING_STEPS: readonly StepDefinition[] = [
  ROOTS,
  PROJECTS,
  DEFAULTS,
  ACCOUNTS,
  PREREQUISITES,
];
