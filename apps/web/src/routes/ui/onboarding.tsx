import type {
  AccountSummary,
  OnboardingFlow,
  OnboardingStep,
  OnboardingStepId,
  ProviderLogin,
} from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { OnboardingHeader } from '@/components/onboarding/header.tsx';
import { ONBOARDING_COLUMN, OnboardingStepView } from '@/components/onboarding/step.tsx';
import { createSampleAccounts } from './sample-accounts.ts';
import { acknowledgeSample } from './samples.ts';
import { Specimen } from './section.tsx';

const USER_HOME = '/Users/sam';

const LABELS: [OnboardingStepId, string, string][] = [
  ['roots', 'Folders', '~/Developer'],
  ['projects', 'Projects', '6 projects'],
  ['defaults', 'Defaults', 'Opus 5.5 · Squash · Plan first'],
  ['accounts', 'Claude', '2 accounts'],
  ['prerequisites', 'Tools', ''],
];

function createSampleStep(
  step: Partial<OnboardingStep> & Pick<OnboardingStep, 'id' | 'title'>
): OnboardingStep {
  return {
    description: '',
    multiple: false,
    options: [],
    groups: [],
    projects: [],
    filed: [],
    conversation: [],
    access: [],
    checks: [],
    ready: true,
    problem: null,
    help: null,
    submitLabel: 'Continue',
    ...step,
  };
}

function createSampleFlow(step: OnboardingStep | null, revisit = false): OnboardingFlow {
  const index = step ? LABELS.findIndex(([id]) => id === step.id) : LABELS.length;
  return {
    steps: LABELS.map(([id, label, summary], position) => ({
      id,
      label,
      summary: position < index && summary ? summary : null,
      reached: revisit || position <= index,
    })),
    index,
    step,
    revisit,
    welcome: null,
  };
}

const FOLDERS = createSampleStep({
  id: 'roots',
  title: 'Where do you keep your repositories?',
  description:
    'Shinsa looks for a task’s repository in the folders you pick. Add any other folder by its path.',
  multiple: true,
  options: [
    {
      value: `${USER_HOME}/Developer`,
      label: '~/Developer',
      detail: '12 repositories',
      chosen: true,
      recommended: false,
    },
    {
      value: `${USER_HOME}/oss`,
      label: '~/oss',
      detail: '3 repositories',
      chosen: false,
      recommended: false,
    },
    {
      value: `${USER_HOME}/work`,
      label: '~/work',
      detail: '1 repository',
      chosen: false,
      recommended: false,
    },
  ],
});

const PRIVATE_FOLDERS = createSampleStep({
  ...FOLDERS,
  options: [
    ...FOLDERS.options,
    {
      value: `${USER_HOME}/Documents`,
      label: '~/Documents',
      detail: null,
      chosen: true,
      recommended: false,
    },
  ],
  access: [`${USER_HOME}/Documents`],
});

function createSampleRepos(folder: string, names: string[]) {
  return names.map((name) => ({ path: `${USER_HOME}/${folder}/${name}`, name }));
}

const PROJECTS = createSampleStep({
  id: 'projects',
  title: 'Shinsa sorted your repositories into projects',
  description:
    'Grouped by GitHub owner and folder. Rename or leave out what you do not want, or ask for a change in your own words.',
  conversation: [
    {
      request: 'Give the iOS app its own project',
      reply: 'I moved paywall-ios into a new Superwall iOS project.',
    },
  ],
  submitLabel: 'Create 3 projects',
  projects: [
    {
      id: 'owner:superwall',
      name: 'Superwall',
      key: 'SUP',
      color: 'sky',
      projectId: null,
      folders: [`${USER_HOME}/Superwall`],
      repos: createSampleRepos('Superwall', ['paywall-next', 'ios', 'android', 'docs', 'web']),
    },
    {
      id: 'owner:buzzkit-dev',
      name: 'Buzzkit',
      key: 'BUZ',
      color: 'orange',
      projectId: null,
      folders: [],
      repos: createSampleRepos('Developer', ['buzzkit', 'buzzkit-ios']),
    },
    {
      id: 'personal',
      name: 'Personal',
      key: 'PER',
      color: 'blue',
      projectId: null,
      folders: [],
      repos: createSampleRepos('Developer', ['dotfiles', 'notes', 'website']),
    },
  ],
});

function createSampleChoice(value: string, label: string, detail: string, chosen = false) {
  return { value, label, detail, chosen, recommended: chosen };
}

const DEFAULTS = createSampleStep({
  id: 'defaults',
  title: 'How should agents work?',
  description:
    'The recommended choices are picked. Continue to keep them; you can change any of them in Settings.',
  groups: [
    {
      id: 'model',
      label: 'Model',
      options: [
        createSampleChoice('model=opus', 'Opus 5.5', 'Most capable for complex work', true),
        createSampleChoice('model=sonnet', 'Sonnet 5.5', 'Efficient for routine tasks'),
        createSampleChoice(
          'model=:roles',
          'Each role’s own model',
          'Planning, building and review each start on the model Shinsa picks for that role.'
        ),
      ],
    },
    {
      id: 'merge',
      label: 'Merging',
      options: [
        createSampleChoice('merge=squash', 'Squash', 'Every pull request lands as one commit.', true),
        createSampleChoice('merge=merge', 'Merge commit', 'Every commit is kept, joined by a merge commit.'),
        createSampleChoice(
          'merge=rebase',
          'Rebase',
          'The commits are replayed onto the default branch, with no merge commit.'
        ),
      ],
    },
    {
      id: 'plans',
      label: 'Plans',
      options: [
        createSampleChoice(
          'plans=large',
          'Show me large plans first',
          'Before building a plan with more than 3 phases or 6 files, the agent waits for you to approve it.',
          true
        ),
        createSampleChoice(
          'plans=always',
          'Show me every plan first',
          'The agent waits for you to approve every plan before it builds.'
        ),
        createSampleChoice(
          'plans=when_asked',
          'Start building',
          'Agents plan on their own and show you a plan only when you ask for one.'
        ),
      ],
    },
  ],
});

const CLAUDE_CODE = {
  id: 'claude',
  label: 'Claude Code',
  ok: true,
  detail: '2.1.314 (Claude Code)',
  fix: null,
  command: null,
};

const ACCOUNTS = createSampleStep({
  id: 'accounts',
  title: 'Sign in with Claude',
  description:
    'Agents work under these Claude accounts. When one runs out of usage, Shinsa moves the work to the next.',
  checks: [CLAUDE_CODE],
});

const NO_ACCOUNTS = createSampleStep({
  ...ACCOUNTS,
  description:
    'Sign in to the Claude account agents work under. You can add more accounts later in Settings.',
  ready: false,
});

const NO_CLAUDE_CODE = createSampleStep({
  ...NO_ACCOUNTS,
  description:
    'Agents run on Claude Code. Install it here, then sign in to the Claude account agents work under.',
  ready: false,
  checks: [
    {
      ...CLAUDE_CODE,
      ok: false,
      detail: 'Not installed.',
      fix: 'Install Claude Code, which agents run on.',
      command: 'curl -fsSL https://claude.ai/install.sh | bash',
    },
  ],
});

const TOOLS = createSampleStep({
  id: 'prerequisites',
  title: 'The tools Shinsa runs',
  description:
    'Some tools are missing. Install each one here, or ask an agent for help when an install fails. Setup finishes once every one is there.',
  ready: false,
  submitLabel: 'Finish setup',
  checks: [
    { id: 'git', label: 'Git', ok: true, detail: 'git version 2.50.1', fix: null, command: null },
    {
      id: 'gh',
      label: 'GitHub CLI',
      ok: false,
      detail: 'Not signed in.',
      fix: 'Sign in to GitHub, so Shinsa can open and merge pull requests.',
      command: 'gh auth login',
      signIn: true,
    },
    {
      id: 'codex',
      label: 'Codex',
      ok: false,
      detail: 'Codex is missing.',
      fix: 'Only for agents you run on Codex.',
      command: 'npm install -g @openai/codex',
      optional: true,
    },
  ],
});

const SAMPLE_ORIGINS: Record<string, AccountSummary['origin']> = {
  work: 'login',
  team: 'login',
  lapsed: 'login',
};

function listSampleAccounts() {
  return createSampleAccounts(Date.now()).accounts.flatMap((account) => {
    const origin = SAMPLE_ORIGINS[account.id];
    return origin ? [{ ...account, origin }] : [];
  });
}

const ACTIONS = {
  answer: () => void acknowledgeSample(),
  open: () => void acknowledgeSample(),
  refresh: () => void acknowledgeSample(),
  help: () => void acknowledgeSample(),
  openPrivacy: () => void acknowledgeSample(),
  revise: () => acknowledgeSample(),
};

const SAMPLE_PROVIDERS: ProviderLogin[] = [
  {
    provider: 'codex',
    label: 'Codex',
    status: 'signed_out',
    method: null,
    version: '0.50.0',
    detail: 'Not logged in',
    fix: 'Sign in with `codex login`.',
  },
];

const ACCOUNT_ACTIONS = {
  signIn: () => void acknowledgeSample(),
  remove: () => void acknowledgeSample(),
};

function StepSpecimen({
  step,
  revisit = false,
  signedIn = true,
}: {
  step: OnboardingStep;
  revisit?: boolean;
  signedIn?: boolean;
}) {
  const [accounts] = React.useState(() => (signedIn ? listSampleAccounts() : []));
  const flow = createSampleFlow(step, revisit);
  return (
    <div className={cn(ONBOARDING_COLUMN, 'mx-0 px-0')}>
      <OnboardingHeader flow={flow} onOpen={() => void acknowledgeSample()} />
      <OnboardingStepView
        flow={flow}
        step={step}
        pending={null}
        userHome={USER_HOME}
        accounts={{
          list: accounts,
          providers: SAMPLE_PROVIDERS,
          actions: ACCOUNT_ACTIONS,
          refresh: () => void acknowledgeSample(),
        }}
        actions={ACTIONS}
        onClose={revisit ? () => void acknowledgeSample() : undefined}
        autoFocus={false}
      />
    </div>
  );
}

export function OnboardingSpecimens() {
  return (
    <>
      <Specimen label='Folders · several at once, the one with the most repositories picked, more by path'>
        <StepSpecimen step={FOLDERS} />
      </Specimen>
      <Specimen label='Folders · one macOS keeps private, with the way to allow it or leave it out'>
        <StepSpecimen step={PRIVATE_FOLDERS} />
      </Specimen>
      <Specimen label='Projects · suggested from the folders, all kept; rename one, untick it or open its repositories'>
        <StepSpecimen step={PROJECTS} />
      </Specimen>
      <Specimen label='Defaults · the recommended choice picked in each group, Continue keeps them all; run again from Settings'>
        <StepSpecimen step={DEFAULTS} revisit />
      </Specimen>
      <Specimen label='Claude · Claude Code missing, installed here first with its Install button'>
        <StepSpecimen step={NO_CLAUDE_CODE} signedIn={false} />
      </Specimen>
      <Specimen label='Claude · no account yet, one Sign in with Claude button'>
        <StepSpecimen step={NO_ACCOUNTS} signedIn={false} />
      </Specimen>
      <Specimen label='Claude · each account signed in here, one signed out, each removable'>
        <StepSpecimen step={ACCOUNTS} />
      </Specimen>
      <Specimen label='Tools · passed, missing with Install, optional, and asking an agent for help'>
        <StepSpecimen step={TOOLS} />
      </Specimen>
      <Specimen label='Tools · an agent looking into the failing checks'>
        <StepSpecimen step={createSampleStep({ ...TOOLS, help: 'help-task' })} />
      </Specimen>
    </>
  );
}
