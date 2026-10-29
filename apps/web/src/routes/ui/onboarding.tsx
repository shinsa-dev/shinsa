import type { AccountSummary, OnboardingFlow, OnboardingStep, OnboardingStepId } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { OnboardingFinished } from '@/components/onboarding/finished.tsx';
import { ONBOARDING_COLUMN, OnboardingStepView } from '@/components/onboarding/step.tsx';
import { OnboardingStepper } from '@/components/onboarding/stepper.tsx';
import { createSampleAccounts } from './sample-accounts.ts';
import { acknowledgeSample } from './samples.ts';
import { Specimen } from './section.tsx';

const USER_HOME = '/Users/sam';

const LABELS: [OnboardingStepId, string, string][] = [
  ['roots', 'Folders', '~/Developer'],
  ['projects', 'Projects', '6 projects'],
  ['defaults', 'Defaults', 'Opus 5.5 · Squash · Plan first'],
  ['accounts', 'Accounts', '2 accounts'],
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
    access: [],
    checks: [],
    ready: true,
    imported: [],
    notes: [],
    problem: null,
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
    'Grouped by GitHub owner and folder. Rename a project or leave out what you do not want; you can change them later in Settings.',
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
      label: 'Large tasks',
      options: [
        createSampleChoice(
          'plans=yes',
          'Show me the plan first',
          'Before building a large task, the agent waits for you to approve its plan.',
          true
        ),
        createSampleChoice(
          'plans=no',
          'Start building',
          'Agents plan on their own and show you a plan only when you ask for one.'
        ),
      ],
    },
  ],
});

const ACCOUNTS = createSampleStep({
  id: 'accounts',
  title: 'Which Claude accounts can agents use?',
  description: 'Agents work under these. When one runs out of usage, Shinsa moves the work to the next.',
  imported: [{ origin: 'cswap', email: 'agents@superwall.com', plan: null }],
  notes: ['claude-swap did not hand over side@superwall.com. Sign in to it instead.'],
});

const TOOLS = createSampleStep({
  id: 'prerequisites',
  title: 'The tools Shinsa runs',
  description: 'Some tools are missing. Each one says how to install it; check again when you are done.',
  ready: false,
  submitLabel: 'Finish anyway',
  checks: [
    { id: 'git', label: 'Git', ok: true, detail: 'git version 2.50.1', fix: null, command: null },
    {
      id: 'gh_auth',
      label: 'Signed in to GitHub',
      ok: false,
      detail: 'Not signed in.',
      fix: 'Sign in to GitHub in a terminal.',
      command: 'gh auth login',
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
  work: 'claude',
  team: 'cswap',
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
  openPrivacy: () => void acknowledgeSample(),
};

const ACCOUNT_ACTIONS = {
  signIn: () => void acknowledgeSample(),
  remove: () => void acknowledgeSample(),
};

function StepSpecimen({ step, revisit = false }: { step: OnboardingStep; revisit?: boolean }) {
  const [accounts] = React.useState(() => listSampleAccounts());
  const flow = createSampleFlow(step, revisit);
  return (
    <div className={cn(ONBOARDING_COLUMN, 'mx-0 px-0')}>
      <OnboardingStepper flow={flow} step={step} onOpen={() => void acknowledgeSample()} />
      <OnboardingStepView
        flow={flow}
        step={step}
        pending={null}
        direction='forward'
        userHome={USER_HOME}
        accounts={{ list: accounts, actions: ACCOUNT_ACTIONS }}
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
      <Specimen label='Accounts · imported for you, one added now, one that could not be, each removable'>
        <StepSpecimen step={ACCOUNTS} />
      </Specimen>
      <Specimen label='Tools · passed, failed with its fix and the command to copy, optional and missing'>
        <StepSpecimen step={TOOLS} />
      </Specimen>
      <Specimen label='Finished · what you set up and the way home'>
        <div className={cn(ONBOARDING_COLUMN, 'mx-0 px-0')}>
          <OnboardingFinished flow={createSampleFlow(null)} onHome={() => void acknowledgeSample()} />
        </div>
      </Specimen>
    </>
  );
}
