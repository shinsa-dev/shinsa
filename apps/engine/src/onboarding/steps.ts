import {
  type AgentModel,
  DomainError,
  describeList,
  type OnboardingChoiceGroup,
  type OnboardingChoiceGroupId,
  type OnboardingOption,
  type PlanApproval,
  parseChoiceValue,
  resolveDisplayPath,
  resolveModelLabel,
  type Settings,
  serializeChoiceValue,
} from '@shinsa/core';
import { Effect } from 'effect';
import type { ClaudeAccount } from './accounts.ts';
import {
  CONTINUE,
  MAX_SUGGESTIONS,
  MERGE_OPTIONS,
  PLAN_OPTIONS,
  RECOMMENDED_MERGE,
  RECOMMENDED_PLANS,
  ROLE_MODELS,
  type StepDefinition,
  type StepReadContext,
  type StepView,
} from './steps/schema.ts';

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
  if (values.length === 1 && values[0] === CONTINUE) return Effect.void;
  return Effect.fail(new DomainError({ code: 'answer_invalid', message: 'Continue to the next step.' }));
}

const ROOTS: StepDefinition = {
  id: 'roots',
  label: 'Folders',
  view: Effect.fn('OnboardingSteps.roots.view')(function* (context, _answered, picked) {
    const { suggestions, refused } = yield* context.suggestRoots;
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
    for (const path of refused.slice(0, MAX_SUGGESTIONS)) {
      options.push(
        createOption(
          path,
          resolveDisplayPath(path, context.userHome),
          'macOS keeps this folder private',
          configured.has(path)
        )
      );
    }
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
  }),
  summarize: (context) => {
    const [first = null, ...rest] = context.roots.map((root) => resolveDisplayPath(root, context.userHome));
    return Effect.succeed(rest.length === 0 ? first : `${first} and ${rest.length} more`);
  },
  answer: Effect.fn('OnboardingSteps.roots.answer')(function* (values, context) {
    const roots = yield* context.resolveRoots(values);
    yield* context.save({ roots });
  }),
};

function describeProjectCount(count: number) {
  return count === 1 ? '1 project' : `${count} projects`;
}

const PROJECTS: StepDefinition = {
  id: 'projects',
  label: 'Projects',
  view: Effect.fn('OnboardingSteps.projects.view')(function* (context) {
    const projects = yield* context.suggestProjects;
    const filed = yield* context.listFiledProjects;
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
  }),
  summarize: (context) =>
    Effect.succeed(context.projectCount === 0 ? null : describeProjectCount(context.projectCount)),
  answer: Effect.fn('OnboardingSteps.projects.answer')(function* (values, context, projects) {
    yield* assertContinue(values);
    yield* context.createProjects(projects);
  }),
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

function listModelChoices(context: StepReadContext, models: AgentModel[]) {
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

const listDefaultGroups = Effect.fn('OnboardingSteps.listDefaultGroups')(function* (
  context: StepReadContext,
  answered: boolean
) {
  const models = yield* context.listModels;
  const groups: OnboardingChoiceGroup[] = [
    { id: 'model', label: 'Model', options: listModelChoices(context, models) },
    { id: 'merge', label: 'Merging', options: listMergeChoices(context, answered) },
    { id: 'plans', label: 'Plans', options: listPlanChoices(context, answered) },
  ];
  return groups;
});

const findGroupValue = Effect.fn('OnboardingSteps.findGroupValue')(function* (
  group: OnboardingChoiceGroup,
  values: string[]
) {
  const picks = values.filter((value) => parseChoiceValue(value)?.group === group.id);
  const option = group.options.find((entry) => entry.value === picks[0]);
  if (picks.length !== 1 || !option) {
    const labels = group.options.map((entry) => entry.label);
    return yield* new DomainError({
      code: 'answer_invalid',
      message: `Pick one ${group.label.toLowerCase()} option: ${describeList(labels, 'or')}.`,
    });
  }
  return parseChoiceValue(option.value)?.value as string;
});

function resolveMergeLabel(method: Settings['mergeMethod']) {
  return MERGE_OPTIONS.find((option) => option.value === method)?.label as string;
}

const DEFAULTS: StepDefinition = {
  id: 'defaults',
  label: 'Defaults',
  view: Effect.fn('OnboardingSteps.defaults.view')(function* (context, answered) {
    return createView({
      title: 'How should agents work?',
      description:
        'The recommended choices are picked. Continue to keep them; you can change any of them in Settings.',
      groups: yield* listDefaultGroups(context, answered),
    });
  }),
  summarize: (context) => {
    const { defaultModel, mergeMethod, approvePlans } = context.settings;
    const parts = [
      defaultModel ? resolveModelLabel(defaultModel) : 'Each role’s own model',
      resolveMergeLabel(mergeMethod),
      resolvePlanLabel(approvePlans),
    ];
    return Effect.succeed(parts.join(' · '));
  },
  answer: Effect.fn('OnboardingSteps.defaults.answer')(function* (values, context) {
    const groups = yield* listDefaultGroups(context, false);
    const [model, merge, plans] = yield* Effect.forEach(groups, (group) => findGroupValue(group, values));
    yield* context.save({
      defaultModel: model === ROLE_MODELS ? null : (model as string),
      mergeMethod: merge as Settings['mergeMethod'],
      approvePlans: plans as PlanApproval,
    });
  }),
};

function describeAccountCount(accounts: ClaudeAccount[]) {
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
  view: Effect.fn('OnboardingSteps.accounts.view')(function* (context) {
    const [accounts, report] = yield* Effect.all([context.listAccounts, context.checkPrerequisites], {
      concurrency: 'unbounded',
    });
    const checks = report.checks.filter((check) => check.id === 'claude');
    const installed = checks.every((check) => check.ok);
    const signedIn = accounts.some((account) => account.signedIn);
    return createView({
      title: 'Sign in with Claude',
      description: describeAccountsStep(installed, signedIn),
      checks,
      ready: installed && signedIn,
    });
  }),
  summarize: (context) => Effect.map(context.listAccounts, describeAccountCount),
  answer: Effect.fn('OnboardingSteps.accounts.answer')(function* (values, context) {
    yield* assertContinue(values);
    const accounts = yield* context.listAccounts;
    if (!accounts.some((account) => account.signedIn)) {
      return yield* new DomainError({
        code: 'account_required',
        message: 'Sign in to a Claude account first. Agents work under it.',
      });
    }
  }),
};

const PREREQUISITES: StepDefinition = {
  id: 'prerequisites',
  label: 'Tools',
  view: Effect.fn('OnboardingSteps.prerequisites.view')(function* (context) {
    const report = yield* context.checkPrerequisites;
    return createView({
      title: 'The tools Shinsa runs',
      description: report.ready
        ? 'Everything Shinsa needs is installed on this machine.'
        : 'Some tools are missing. Install each one here, or ask an agent for help when an install fails. Setup finishes once every one is there.',
      checks: report.checks,
      ready: report.ready,
      submitLabel: 'Finish setup',
    });
  }),
  summarize: () => Effect.succeed(null),
  answer: Effect.fn('OnboardingSteps.prerequisites.answer')(function* (values, context) {
    yield* assertContinue(values);
    if (!(yield* context.checkPrerequisites).ready) {
      return yield* new DomainError({
        code: 'tools_missing',
        message: 'Install the missing tools first. Setup finishes once every one is there.',
      });
    }
  }),
};

export const ONBOARDING_STEPS: readonly StepDefinition[] = [
  ROOTS,
  PROJECTS,
  DEFAULTS,
  ACCOUNTS,
  PREREQUISITES,
];
