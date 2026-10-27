import {
  type AgentModel,
  DomainError,
  describeList,
  type OnboardingCheck,
  type OnboardingOption,
  type OnboardingStepId,
  type RootSuggestions,
  resolveDisplayPath,
  resolveModelLabel,
  type Settings,
} from '@shinsa/core';
import type { AccountSource, ClaudeAccount } from './accounts.ts';
import type { PrerequisiteReport } from './prerequisites.ts';
import { resolveChosenRoots } from './roots.ts';

export interface SetupPatch {
  roots?: string[];
  defaultModel?: string | null;
  mergeMethod?: Settings['mergeMethod'];
  approvePlans?: boolean;
}

interface StepContext {
  userHome: string;
  settings: Settings;
  roots: string[];
  suggestRoots: () => Promise<RootSuggestions>;
  listModels: () => Promise<AgentModel[]>;
  listAccounts: AccountSource;
  checkPrerequisites: () => Promise<PrerequisiteReport>;
  save: (patch: SetupPatch) => Promise<void>;
}

export type StepReadContext = Omit<StepContext, 'save'>;

interface StepView {
  title: string;
  description: string;
  multiple: boolean;
  options: OnboardingOption[];
  checks: OnboardingCheck[];
  ready: boolean;
  submitLabel: string;
}

export interface StepDefinition {
  id: OnboardingStepId;
  label: string;
  view: (context: StepReadContext, answered: boolean) => Promise<StepView>;
  summarize: (context: StepReadContext) => Promise<string | null>;
  answer: (values: string[], context: StepContext) => Promise<void>;
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
    checks: [],
    ready: true,
    submitLabel: 'Continue',
    ...view,
  };
}

function describeRepoCount(count: number) {
  return count === 1 ? '1 repository' : `${count} repositories`;
}

function findOneOption(values: string[], options: OnboardingOption[]) {
  const [value] = values;
  const option = options.find((entry) => entry.value === value);
  if (values.length !== 1 || !option) {
    const labels = options.map((entry) => entry.label);
    throw new DomainError('answer_invalid', `Pick one of these: ${describeList(labels, 'or')}.`);
  }
  return option;
}

function assertContinue(values: string[]) {
  if (values.length !== 1 || values[0] !== CONTINUE) {
    throw new DomainError('answer_invalid', 'Continue to the next step.');
  }
}

const ROOTS: StepDefinition = {
  id: 'roots',
  label: 'Folders',
  view: async (context) => {
    const { suggestions } = await context.suggestRoots();
    const configured = new Set(context.roots);
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

function resolveModelMeaning(model: AgentModel) {
  const [, meaning] = model.description.split(' · ');
  return meaning ?? (model.description || null);
}

async function listModelOptions(context: StepReadContext, answered: boolean) {
  const models = await context.listModels();
  const current = context.settings.defaultModel;
  const options = models.map((model) =>
    createOption(model.id, model.label, resolveModelMeaning(model), answered && current === model.id)
  );
  if (current && !options.some((option) => option.value === current)) {
    options.unshift(createOption(current, resolveModelLabel(current), null, answered));
  }
  options.push(
    createOption(
      ROLE_MODELS,
      'Each role’s own model',
      'Planning, building and review each start on the model Shinsa picks for that role.',
      answered && current === null
    )
  );
  return options;
}

const MODEL: StepDefinition = {
  id: 'model',
  label: 'Model',
  view: async (context, answered) =>
    createView({
      title: 'Which model should agents use?',
      description: 'This is the default for every role. You can still pick a model per role in Settings.',
      options: await listModelOptions(context, answered),
    }),
  summarize: (context) => {
    const current = context.settings.defaultModel;
    return Promise.resolve(current ? resolveModelLabel(current) : 'Each role’s own');
  },
  answer: async (values, context) => {
    const option = findOneOption(values, await listModelOptions(context, false));
    await context.save({ defaultModel: option.value === ROLE_MODELS ? null : option.value });
  },
};

const MERGE_OPTIONS: { value: Settings['mergeMethod']; label: string; detail: string }[] = [
  { value: 'squash', label: 'Squash', detail: 'Every pull request lands as one commit.' },
  { value: 'merge', label: 'Merge commit', detail: 'Every commit is kept, joined by a merge commit.' },
  {
    value: 'rebase',
    label: 'Rebase',
    detail: 'The commits are replayed onto the default branch, with no merge commit.',
  },
];

function listMergeOptions(context: StepReadContext, answered: boolean) {
  return MERGE_OPTIONS.map((option) =>
    createOption(
      option.value,
      option.label,
      option.detail,
      answered && context.settings.mergeMethod === option.value,
      option.value === 'squash'
    )
  );
}

const MERGE: StepDefinition = {
  id: 'merge',
  label: 'Merging',
  view: (context, answered) =>
    Promise.resolve(
      createView({
        title: 'How should pull requests be merged?',
        description: 'Shinsa merges a pull request only after you approve the merge.',
        options: listMergeOptions(context, answered),
      })
    ),
  summarize: (context) =>
    Promise.resolve(
      MERGE_OPTIONS.find((option) => option.value === context.settings.mergeMethod)?.label ?? null
    ),
  answer: async (values, context) => {
    const option = findOneOption(values, listMergeOptions(context, false));
    await context.save({ mergeMethod: option.value as Settings['mergeMethod'] });
  },
};

function listPlanOptions(context: StepReadContext, answered: boolean) {
  const approves = context.settings.approvePlans === true;
  return [
    createOption(
      'yes',
      'Show me the plan first',
      'Before building a large task, the agent waits for you to approve its plan.',
      answered && approves,
      true
    ),
    createOption(
      'no',
      'Start building',
      'Agents plan on their own and show you a plan only when you ask for one.',
      answered && !approves
    ),
  ];
}

const PLANS: StepDefinition = {
  id: 'plans',
  label: 'Plans',
  view: (context, answered) =>
    Promise.resolve(
      createView({
        title: 'Should agents ask before they build a large task?',
        description: 'Small tasks always start straight away. You can change this in Settings.',
        options: listPlanOptions(context, answered),
      })
    ),
  summarize: (context) =>
    Promise.resolve(context.settings.approvePlans === true ? 'Plan first' : 'Start building'),
  answer: async (values, context) => {
    const option = findOneOption(values, listPlanOptions(context, false));
    await context.save({ approvePlans: option.value === 'yes' });
  },
};

function describeAccountCount(accounts: ClaudeAccount[]) {
  if (accounts.length === 0) return 'None yet';
  return accounts.length === 1 ? '1 account' : `${accounts.length} accounts`;
}

const ACCOUNTS: StepDefinition = {
  id: 'accounts',
  label: 'Accounts',
  view: async (context) => {
    const accounts = await context.listAccounts();
    const signedIn = accounts.some((account) => account.signedIn);
    return createView({
      title: 'Which Claude accounts can agents use?',
      description: signedIn
        ? 'Agents work under these. When one runs out of usage, Shinsa moves the work to the next.'
        : 'Agents need a Claude account to work. Sign in with one, or add it later in Settings.',
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
        : 'Some tools are missing. Each one says how to install it; check again when you are done.',
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
  MODEL,
  MERGE,
  PLANS,
  ACCOUNTS,
  PREREQUISITES,
];
