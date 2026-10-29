import type {
  AccountSummary,
  OnboardingFlow,
  OnboardingProjectChoice,
  OnboardingStep,
  OnboardingStepId,
} from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Input } from '@shinsa/ui/components/input';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ErrorLine } from '@/components/chat/turn-detail.tsx';
import { OnboardingAccess } from '@/components/onboarding/access.tsx';
import { type OnboardingAccountActions, OnboardingAccounts } from '@/components/onboarding/accounts.tsx';
import { OnboardingChecks } from '@/components/onboarding/checks.tsx';
import { OptionList } from '@/components/onboarding/options.tsx';
import { OnboardingProjects } from '@/components/onboarding/projects.tsx';
import { OnboardingSection } from '@/components/onboarding/section.tsx';
import { SETTING_ROW } from '@/components/settings/group.tsx';
import { useWindowReturn } from '@/hooks/use-window-return.ts';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import {
  ACCESS_KEY,
  listChosenValues,
  listReadableRoots,
  REFRESH_KEY,
  resolveFolderOptions,
  resolveSubmitValues,
  resolveToggledRoots,
  type StepDirection,
  SUBMIT_KEY,
} from '@/lib/onboarding.ts';
import {
  createProjectDrafts,
  describeProjectsSubmit,
  isProjectsReady,
  type ProjectDraft,
  resolveProjectChoices,
  updateProjectDraft,
} from '@/lib/onboarding-projects.ts';

export const ONBOARDING_COLUMN = 'mx-auto flex w-full max-w-xl flex-col gap-6 px-6';

export interface OnboardingStepActions {
  openPrivacy: () => void;
  answer: (
    stepId: OnboardingStepId,
    values: string[],
    key?: string,
    projects?: OnboardingProjectChoice[]
  ) => void;
  open: (stepId: OnboardingStepId) => void;
  refresh: () => void;
}

export interface OnboardingAccountsView {
  list: AccountSummary[] | null;
  actions: OnboardingAccountActions;
}

function AddFolderField({ onAdd }: { onAdd: (path: string) => void }) {
  const [path, setPath] = React.useState('');
  const trimmed = path.trim();
  return (
    <form
      className={cn(SETTING_ROW, 'mx-1 mb-1 gap-1.5 px-1.5 first:mt-1')}
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed) return;
        onAdd(trimmed);
        setPath('');
      }}
    >
      <Input
        size='sm'
        value={path}
        onChange={(event) => setPath(event.target.value)}
        placeholder='Add a folder by its path, like ~/code'
        aria-label='Folder path'
        spellCheck={false}
        autoComplete='off'
      />
      <Button type='submit' variant='secondary' size='sm' icon='IconPlusMedium' disabled={!trimmed}>
        Add folder
      </Button>
    </form>
  );
}

function FoldersBody({
  step,
  userHome,
  values,
  onChange,
  pending,
  actions,
  autoFocus,
}: {
  step: OnboardingStep;
  userHome: string;
  values: string[];
  onChange: (values: string[]) => void;
  pending: string | null;
  actions: OnboardingStepActions;
  autoFocus: boolean;
}) {
  const [typed, setTyped] = React.useState<string[]>([]);
  const options = resolveFolderOptions(step.options, typed, userHome);
  const busy = pending !== null;
  return (
    <>
      {step.access.length > 0 && (
        <OnboardingAccess
          access={step.access}
          userHome={userHome}
          checking={pending === ACCESS_KEY}
          disabled={busy}
          actions={{
            openSettings: actions.openPrivacy,
            check: () => actions.answer(step.id, values, ACCESS_KEY),
            leaveOut: () => {
              const readable = listReadableRoots(values, step.access, userHome);
              onChange(readable);
              if (readable.length > 0) actions.answer(step.id, readable, SUBMIT_KEY);
            },
          }}
        />
      )}
      <OptionList
        options={options}
        values={values}
        multiple
        label='Folders'
        busyValue={null}
        disabled={busy}
        autoFocus={autoFocus}
        onPick={(value) => onChange(resolveToggledRoots(values, value))}
      >
        <AddFolderField
          onAdd={(path) => {
            setTyped([...typed, path]);
            if (!values.includes(path)) onChange([...values, path]);
          }}
        />
      </OptionList>
    </>
  );
}

interface ProjectDrafts {
  list: ProjectDraft[];
  onChange: (id: string, patch: Partial<ProjectDraft>) => void;
}

function StepBody({
  step,
  values,
  pending,
  userHome,
  accounts,
  actions,
  drafts,
  onChange,
  autoFocus,
}: {
  step: OnboardingStep;
  values: string[];
  pending: string | null;
  userHome: string;
  accounts: OnboardingAccountsView;
  actions: OnboardingStepActions;
  drafts: ProjectDrafts;
  onChange: (values: string[]) => void;
  autoFocus: boolean;
}) {
  if (step.id === 'projects') {
    return (
      <OnboardingProjects
        projects={step.projects}
        drafts={drafts.list}
        disabled={pending !== null}
        userHome={userHome}
        onChange={drafts.onChange}
      />
    );
  }
  if (step.id === 'roots') {
    return (
      <FoldersBody
        step={step}
        userHome={userHome}
        values={values}
        onChange={onChange}
        pending={pending}
        actions={actions}
        autoFocus={autoFocus}
      />
    );
  }
  if (step.id === 'accounts') {
    return (
      <OnboardingAccounts
        accounts={accounts.list}
        imported={step.imported}
        notes={step.notes}
        actions={accounts.actions}
      />
    );
  }
  if (step.id === 'prerequisites') {
    return <OnboardingChecks checks={step.checks} />;
  }
  return (
    <OptionList
      options={step.options}
      values={values}
      multiple={false}
      label={step.title}
      busyValue={pending}
      disabled={pending !== null}
      autoFocus={autoFocus}
      onPick={(value) => {
        onChange([value]);
        actions.answer(step.id, [value], value);
      }}
    />
  );
}

function StepAction({
  step,
  pending,
  accounts,
  actions,
}: {
  step: OnboardingStep;
  pending: string | null;
  accounts: OnboardingAccountsView;
  actions: OnboardingStepActions;
}) {
  if (step.id === 'accounts') {
    return (
      <Button variant='secondary' icon='IconUserAdd' onClick={() => accounts.actions.signIn(null)}>
        {accounts.list?.length === 0 ? 'Sign in to Claude' : ACCOUNT_LABEL.add}
      </Button>
    );
  }
  if (step.id !== 'prerequisites') return null;
  return (
    <Button
      variant='secondary'
      icon='IconArrowRotateClockwise'
      loading={pending === REFRESH_KEY}
      onClick={actions.refresh}
    >
      Check again
    </Button>
  );
}

function resolveSubmit(step: OnboardingStep, values: string[], drafts: ProjectDraft[]) {
  const submitValues = resolveSubmitValues(step, values);
  if (step.id !== 'projects' || step.projects.length === 0) {
    return {
      values: submitValues,
      label: step.submitLabel,
      ready: submitValues.length > 0,
      projects: undefined,
    };
  }
  return {
    values: submitValues,
    label: describeProjectsSubmit(step.projects, drafts),
    ready: isProjectsReady(step.projects, drafts),
    projects: resolveProjectChoices(step.projects, drafts),
  };
}

function StepFooter({
  flow,
  step,
  values,
  drafts,
  pending,
  accounts,
  actions,
  onClose,
}: {
  flow: OnboardingFlow;
  step: OnboardingStep;
  values: string[];
  drafts: ProjectDraft[];
  pending: string | null;
  accounts: OnboardingAccountsView;
  actions: OnboardingStepActions;
  onClose?: () => void;
}) {
  const previous = flow.steps[flow.index - 1];
  const submit = resolveSubmit(step, values, drafts);
  const choosing = step.options.length > 0 && !step.multiple;
  return (
    <>
      {previous ? (
        <Button
          variant='secondary'
          icon='IconArrowLeft'
          disabled={pending !== null}
          onClick={() => actions.open(previous.id)}
        >
          Back
        </Button>
      ) : (
        <span />
      )}
      <div className='flex items-center gap-1.5'>
        {onClose && (
          <Button variant='secondary' onClick={onClose}>
            Close setup
          </Button>
        )}
        <StepAction step={step} pending={pending} accounts={accounts} actions={actions} />
        {(!choosing || values.length > 0) && (
          <Button
            icon={{ name: 'IconArrowRight', position: 'inline-end' }}
            disabled={!submit.ready || (pending !== null && pending !== SUBMIT_KEY)}
            loading={pending === SUBMIT_KEY}
            onClick={() => actions.answer(step.id, submit.values, SUBMIT_KEY, submit.projects)}
          >
            {submit.label}
          </Button>
        )}
      </div>
    </>
  );
}

export function OnboardingStepView({
  flow,
  step,
  pending,
  direction,
  userHome,
  accounts,
  actions,
  onClose,
  autoFocus = true,
}: {
  flow: OnboardingFlow;
  step: OnboardingStep;
  pending: string | null;
  direction: StepDirection;
  userHome: string;
  accounts: OnboardingAccountsView;
  actions: OnboardingStepActions;
  onClose?: () => void;
  autoFocus?: boolean;
}) {
  const [values, setValues] = React.useState(() => listChosenValues(step));
  const [drafts, setDrafts] = React.useState(() => createProjectDrafts(step.projects));
  const waiting = step.access.length > 0 || step.id === 'prerequisites';
  useWindowReturn(() => {
    if (pending !== null) return;
    if (step.id === 'prerequisites') actions.refresh();
    else actions.answer(step.id, values, ACCESS_KEY);
  }, waiting);
  return (
    <OnboardingSection
      title={step.title}
      description={step.description}
      direction={direction}
      footer={
        <StepFooter
          flow={flow}
          step={step}
          values={values}
          drafts={drafts}
          pending={pending}
          accounts={accounts}
          actions={actions}
          onClose={onClose}
        />
      }
    >
      <StepBody
        step={step}
        values={values}
        pending={pending}
        userHome={userHome}
        accounts={accounts}
        actions={actions}
        drafts={{ list: drafts, onChange: (id, patch) => setDrafts(updateProjectDraft(drafts, id, patch)) }}
        onChange={setValues}
        autoFocus={autoFocus}
      />
      {step.problem && <ErrorLine text={step.problem} />}
    </OnboardingSection>
  );
}
