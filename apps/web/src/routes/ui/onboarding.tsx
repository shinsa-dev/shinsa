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
  ['model', 'Model', 'Opus 5.5'],
  ['merge', 'Merging', 'Squash'],
  ['plans', 'Plans', 'Plan first'],
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

const MERGE = createSampleStep({
  id: 'merge',
  title: 'How should pull requests be merged?',
  description: 'Shinsa merges a pull request only after you approve the merge.',
  options: [
    {
      value: 'squash',
      label: 'Squash',
      detail: 'Every pull request lands as one commit.',
      chosen: true,
      recommended: true,
    },
    {
      value: 'merge',
      label: 'Merge commit',
      detail: 'Every commit is kept, joined by a merge commit.',
      chosen: false,
      recommended: false,
    },
    {
      value: 'rebase',
      label: 'Rebase',
      detail: 'The commits are replayed onto the default branch, with no merge commit.',
      chosen: false,
      recommended: false,
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
    { id: 'git', label: 'Git', ok: true, detail: 'git version 2.50.1', fix: null },
    {
      id: 'gh_auth',
      label: 'Signed in to GitHub',
      ok: false,
      detail: 'Not signed in.',
      fix: 'Sign in to GitHub with `gh auth login`.',
    },
    { id: 'codex', label: 'Codex', ok: false, detail: 'Codex is missing.', fix: null, optional: true },
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
      <Specimen label='One answer · gone back to, your answer picked and Continue keeps it; run again from Settings'>
        <StepSpecimen step={MERGE} revisit />
      </Specimen>
      <Specimen label='Accounts · imported for you, one added now, one that could not be, each removable'>
        <StepSpecimen step={ACCOUNTS} />
      </Specimen>
      <Specimen label='Tools · passed, failed with its fix, optional and missing'>
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
