import {
  type AgentModel,
  DomainError,
  describeList,
  type OnboardingCheck,
  type OnboardingChoice,
  type OnboardingQuestionId,
  type RootSuggestions,
  resolveDisplayPath,
  resolveModelLabel,
  type Settings,
} from '@shinsa/core';
import { type ChoiceQuestion, describeDecisionQuestion } from '../agents/quick/decide.ts';
import type { AccountActions, AccountSource, ClaudeAccount } from './accounts.ts';
import type { PrerequisiteReport } from './prerequisites.ts';
import { resolveChosenRoots } from './roots.ts';

export interface SetupPatch {
  roots?: string[];
  defaultModel?: string;
  mergeMethod?: Settings['mergeMethod'];
  approvePlans?: boolean;
}

export interface QuestionContext {
  userHome: string;
  settings: Settings;
  roots: string[];
  suggestRoots: () => Promise<RootSuggestions>;
  listModels: () => Promise<AgentModel[]>;
  listAccounts: AccountSource;
  accountActions: AccountActions;
  checkPrerequisites: () => Promise<PrerequisiteReport>;
  save: (patch: SetupPatch, commandId?: string) => Promise<void>;
}

export interface Asked {
  text: string;
  checks: OnboardingCheck[];
  choices: OnboardingChoice[];
  multiple: boolean;
  submitLabel: string | null;
  placeholder: string;
  retry: string;
  meanings?: Record<string, string>;
}

export interface Answer {
  values: string[];
  echo: string;
}

type Outcome = 'next' | 'again';

type Skipped = { values: string[] } | { note: string };

export interface Question {
  id: OnboardingQuestionId;
  confirms: boolean;
  ask: (context: QuestionContext) => Promise<Asked>;
  instruct: (asked: Asked, context: QuestionContext) => string;
  resolve: (values: string[], asked: Asked, context: QuestionContext) => Answer;
  save: (values: string[], context: QuestionContext) => Promise<Outcome>;
  skip: (context: QuestionContext, asked: Asked) => Skipped | null;
}

const MAX_SUGGESTIONS = 8;

const CHOICE_PLACEHOLDER = 'Pick an option or answer in your own words';

const CHOICE_RETRY = 'Pick one of the options or answer again.';

function createChoice(value: string, label: string, chosen = false, detail: string | null = null) {
  return { value, label, detail, chosen } satisfies OnboardingChoice;
}

function describeRepoCount(count: number) {
  return count === 1 ? '1 repository' : `${count} repositories`;
}

function createChoiceAsked(
  text: string,
  choices: OnboardingChoice[],
  meanings: Record<string, string> = {}
): Asked {
  return {
    text,
    checks: [],
    choices,
    multiple: false,
    submitLabel: null,
    placeholder: CHOICE_PLACEHOLDER,
    retry: CHOICE_RETRY,
    meanings,
  };
}

export const UNCLEAR_CHOICE = 'unclear';

export const KEEP_CHOICE = 'keep';

function describeChoiceMeaning(choice: OnboardingChoice, asked: Asked) {
  const meaning = asked.meanings?.[choice.value];
  if (meaning) return `${choice.label}: ${meaning}`;
  return choice.detail ? `${choice.label} (${choice.detail})` : choice.label;
}

export function listOptionMeanings(asked: Asked) {
  return asked.choices.map((choice) => `- ${describeChoiceMeaning(choice, asked)}`);
}

export function resolveChoiceDecision(asked: Asked): ChoiceQuestion {
  return {
    type: 'choice',
    instructions:
      'Which option does the answer choose? It may name the option, describe it in its own words (cheaper, faster, only when I ask) or agree to it.',
    criteria: {
      ...Object.fromEntries(
        asked.choices.map((choice) => [choice.value, describeChoiceMeaning(choice, asked)])
      ),
      [KEEP_CHOICE]:
        'the answer skips the question, has no preference, leaves it to Shinsa or asks to keep the current setting or the default',
      [UNCLEAR_CHOICE]: 'the answer fits none of the options, or could mean more than one of them',
    },
  };
}

function instructChoices(asked: Asked) {
  return [
    'Return {"choice": "<option>"}, answering this decision:',
    describeDecisionQuestion('choice', resolveChoiceDecision(asked)),
  ].join('\n');
}

function resolveOneChoice(values: string[], asked: Asked) {
  const [value] = values;
  const choice = asked.choices.find((entry) => entry.value === value);
  if (values.length !== 1 || !choice) {
    const labels = asked.choices.map((entry) => entry.label);
    throw new DomainError('answer_invalid', `Pick one of these: ${describeList(labels, 'or')}.`);
  }
  return choice;
}

function createChoiceQuestion(
  id: OnboardingQuestionId,
  ask: (context: QuestionContext) => Promise<Asked>,
  echo: (choice: OnboardingChoice) => string,
  save: (value: string, context: QuestionContext) => Promise<Outcome>,
  skip: (context: QuestionContext, asked: Asked) => Skipped | null,
  confirms = true
): Question {
  return {
    id,
    confirms,
    ask,
    skip,
    instruct: instructChoices,
    resolve: (values, asked) => {
      const choice = resolveOneChoice(values, asked);
      return { values: [choice.value], echo: echo(choice) };
    },
    save: (values, context) => save(values[0] ?? '', context),
  };
}

async function updateSetup(context: QuestionContext, patch: SetupPatch): Promise<Outcome> {
  await context.save(patch);
  return 'next';
}

function resolveAction(value: string): Promise<Outcome> {
  return Promise.resolve(value === 'recheck' ? 'again' : 'next');
}

function selectKeptValue(value: string, asked: Asked): Skipped | null {
  return asked.choices.some((choice) => choice.value === value) ? { values: [value] } : null;
}

const KEEP_MODELS = 'Agents keep the model each role starts with. You can change it in Settings.';

const ROOTS: Question = {
  id: 'roots',
  confirms: true,
  ask: async (context) => {
    const { suggestions } = await context.suggestRoots();
    const configured = new Set(context.roots);
    const shown = suggestions.slice(0, MAX_SUGGESTIONS);
    const choices = shown.map((suggestion) =>
      createChoice(
        suggestion.path,
        resolveDisplayPath(suggestion.path, context.userHome),
        configured.has(suggestion.path),
        describeRepoCount(suggestion.repoCount)
      )
    );
    for (const path of configured) {
      if (!choices.some((choice) => choice.value === path)) {
        choices.push(createChoice(path, resolveDisplayPath(path, context.userHome), true));
      }
    }
    const text =
      choices.length > 0
        ? 'Which repository folders should Shinsa use? Shinsa looks for a task’s repository in these folders when you start it. These are the ones I found:'
        : 'Which repository folders should Shinsa use? Shinsa looks for a task’s repository in these folders when you start it. I found no repositories in your home folder, so type the full path of each folder.';
    return {
      text,
      checks: [],
      choices,
      multiple: true,
      submitLabel: 'Use these folders',
      placeholder: 'Pick folders or type their paths',
      retry: 'Pick folders or type their full paths.',
    };
  },
  instruct: (asked, context) =>
    [
      'Return {"understood": true, "values": ["<full path>", …]} with every folder the answer chooses.',
      'Folders found on this machine, most repositories first:',
      ...asked.choices.map((choice) => `- ${choice.value}${choice.detail ? `: ${choice.detail}` : ''}`),
      `"All of them", "the first two" or a folder's name refer to this list. A folder that is not in the list must be written as a full path, or as one starting with ~/ for the home folder (${context.userHome}).`,
      'If the answer does not clearly choose, return {"understood": false, "values": []}.',
    ].join('\n'),
  resolve: (values, asked, context) => {
    const roots = resolveChosenRoots(values, context.userHome);
    const details = new Map(asked.choices.map((choice) => [choice.value, choice.detail]));
    const named = roots.map((root) => {
      const detail = details.get(root);
      const path = resolveDisplayPath(root, context.userHome);
      return detail ? `${path} (${detail})` : path;
    });
    return { values: roots, echo: `You keep your repositories in ${describeList(named, 'and')}.` };
  },
  save: (values, context) => updateSetup(context, { roots: values }),
  skip: (context) => (context.roots.length > 0 ? { values: context.roots } : null),
};

function describeSignInAgain(account: ClaudeAccount) {
  return `Sign in again as ${account.label ?? 'Claude'}`;
}

function describeAccountFix(account: ClaudeAccount) {
  if (account.signedIn) return null;
  return `Choose “${describeSignInAgain(account)}” below.`;
}

function listAccountChecks(accounts: ClaudeAccount[]) {
  return accounts.map((account) => ({
    id: account.id,
    label: account.label ?? 'Claude',
    ok: account.signedIn,
    detail: account.detail,
    fix: describeAccountFix(account),
  }));
}

async function listAccountChoices(context: QuestionContext, accounts: ClaudeAccount[]) {
  const imports = await context.accountActions.listImports();
  return [
    ...accounts
      .filter((account) => !account.signedIn)
      .map((account) => createChoice(`sign_in:${account.id}`, describeSignInAgain(account))),
    ...imports.map((entry) =>
      createChoice(
        `import:${entry.origin}:${entry.email}`,
        entry.origin === 'claude' ? 'Use your Claude Code login' : 'Import from claude-swap',
        false,
        entry.email
      )
    ),
    createChoice('add', 'Sign in with another account'),
  ];
}

const SIGNING_IN = 'Claude opened a browser window to sign in. Finish there, then choose Check again.';

async function askAccounts(context: QuestionContext): Promise<Asked> {
  const accounts = await context.listAccounts();
  const checks = listAccountChecks(accounts);
  const extra = await listAccountChoices(context, accounts);
  const pending = context.accountActions.isSigningIn() ? `${SIGNING_IN} ` : '';
  if (accounts.some((account) => account.signedIn)) {
    return {
      ...createChoiceAsked(
        `${pending}Agents work under your Claude accounts. When one runs out of usage, Shinsa moves the work to another. These are the accounts it can use:`,
        [createChoice('continue', 'Use these accounts'), ...extra, createChoice('recheck', 'Check again')]
      ),
      checks,
    };
  }
  return {
    ...createChoiceAsked(
      `${pending}Agents need a Claude account. Use the login Claude Code already has, or sign in with an account.`,
      [...extra, createChoice('recheck', 'Check again'), createChoice('continue', 'Skip for now')]
    ),
    checks,
  };
}

async function requestAccountChoice(value: string, context: QuestionContext): Promise<Outcome> {
  const actions = context.accountActions;
  const [kind, origin, ...email] = value.split(':');
  if (kind === 'import' && (origin === 'claude' || origin === 'cswap')) {
    await actions.importAccount(origin, email.join(':'));
    return 'again';
  }
  if (value === 'add') {
    await actions.startLogin(null);
    return 'again';
  }
  if (kind === 'sign_in' && origin) {
    await actions.startLogin(origin);
    return 'again';
  }
  return resolveAction(value);
}

function resolveModelMeaning(model: AgentModel) {
  const [, meaning] = model.description.split(' · ');
  return meaning ?? model.description;
}

const MERGE_MEANINGS: Record<Settings['mergeMethod'], string> = {
  squash: 'every pull request lands as one commit',
  merge: 'every commit is kept and a merge commit joins them',
  rebase: 'the commits are replayed onto the default branch, a straight history without a merge commit',
};

const PLAN_MEANINGS: Record<string, string> = {
  yes: 'before building a large task, agents wait until the human approves their plan',
  no: 'agents start building straight away and plan first only when the human asks for a plan',
};

const MERGE_ECHO: Record<Settings['mergeMethod'], string> = {
  squash: 'Pull requests are squashed into one commit when you merge them.',
  merge: 'Pull requests land with a merge commit when you merge them.',
  rebase: 'Pull requests are rebased onto the default branch when you merge them.',
};

export const ONBOARDING_QUESTIONS: readonly Question[] = [
  ROOTS,
  createChoiceQuestion(
    'model',
    async (context) => {
      const models = await context.listModels();
      const current = context.settings.defaultModel;
      const choices = models.map((model) => createChoice(model.id, model.label));
      if (current && !choices.some((choice) => choice.value === current)) {
        choices.unshift(createChoice(current, resolveModelLabel(current)));
      }
      return createChoiceAsked(
        'Which model should agents use by default? You can still pick a model per role in Settings.',
        choices,
        Object.fromEntries(models.map((model) => [model.id, resolveModelMeaning(model)]))
      );
    },
    (choice) => `Agents use ${choice.label} by default.`,
    (value, context) => updateSetup(context, { defaultModel: value }),
    (context, asked) => {
      const current = context.settings.defaultModel;
      return current ? selectKeptValue(current, asked) : { note: KEEP_MODELS };
    }
  ),
  createChoiceQuestion(
    'merge',
    () =>
      Promise.resolve(
        createChoiceAsked(
          'How should Shinsa merge a pull request once you approve the merge?',
          [
            createChoice('squash', 'Squash'),
            createChoice('merge', 'Merge commit'),
            createChoice('rebase', 'Rebase'),
          ],
          MERGE_MEANINGS
        )
      ),
    (choice) => MERGE_ECHO[choice.value as Settings['mergeMethod']],
    (value, context) => updateSetup(context, { mergeMethod: value as Settings['mergeMethod'] }),
    (context, asked) => selectKeptValue(context.settings.mergeMethod, asked)
  ),
  createChoiceQuestion(
    'plans',
    () =>
      Promise.resolve(
        createChoiceAsked(
          'Should agents ask you to approve a plan before they build a large task?',
          [createChoice('yes', 'Yes, for large tasks'), createChoice('no', 'No, start building')],
          PLAN_MEANINGS
        )
      ),
    (choice) =>
      choice.value === 'yes'
        ? 'Agents ask you to approve a plan before they build a large task.'
        : 'Agents start building without asking you to approve a plan.',
    (value, context) => updateSetup(context, { approvePlans: value === 'yes' }),
    (context, asked) => selectKeptValue(context.settings.approvePlans === true ? 'yes' : 'no', asked)
  ),
  createChoiceQuestion(
    'accounts',
    askAccounts,
    (choice) => choice.label,
    requestAccountChoice,
    (_context, asked) => selectKeptValue('continue', asked),
    false
  ),
  createChoiceQuestion(
    'prerequisites',
    async (context) => {
      const report = await context.checkPrerequisites();
      if (report.ready) {
        return {
          ...createChoiceAsked('Last, the tools Shinsa runs on this machine. Everything is installed:', [
            createChoice('continue', 'Finish setup'),
          ]),
          checks: report.checks,
        };
      }
      return {
        ...createChoiceAsked(
          'Last, the tools Shinsa runs on this machine. Some are missing; each one says how to fix it. Check again when you are done.',
          [createChoice('recheck', 'Check again'), createChoice('continue', 'Finish anyway')]
        ),
        checks: report.checks,
      };
    },
    (choice) => choice.label,
    resolveAction,
    (_context, asked) => selectKeptValue('continue', asked),
    false
  ),
];
