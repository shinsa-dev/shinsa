import type {
  AccountSummary,
  OnboardingFlow,
  OnboardingProjectChoice,
  OnboardingStep,
  OnboardingStepId,
  ProviderLogin,
} from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Input } from '@shinsa/ui/components/input';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ErrorLine } from '@/components/chat/turn-detail.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { OnboardingAccess } from '@/components/onboarding/access.tsx';
import {
  type OnboardingAccountActions,
  OnboardingAccounts,
  OnboardingAddAccount,
} from '@/components/onboarding/accounts.tsx';
import { OnboardingChecks } from '@/components/onboarding/checks.tsx';
import { OnboardingDefaults } from '@/components/onboarding/defaults.tsx';
import { OnboardingHelp } from '@/components/onboarding/help.tsx';
import { OptionList } from '@/components/onboarding/options.tsx';
import { OnboardingProjects } from '@/components/onboarding/projects.tsx';
import { OnboardingFiledProjects, OnboardingProjectsChat } from '@/components/onboarding/projects-chat.tsx';
import { OnboardingSection } from '@/components/onboarding/section.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { SETTING_ROW } from '@/components/settings/group.tsx';
import { useWindowReturn } from '@/hooks/use-window-return.ts';
import {
  ACCESS_KEY,
  HELP_KEY,
  isStepInstalled,
  listChosenValues,
  listReadableRoots,
  REFRESH_KEY,
  REVISE_KEY,
  resolveFolderOptions,
  resolveSubmitValues,
  resolveToggledRoots,
  SUBMIT_KEY,
} from '@/lib/onboarding.ts';
import {
  createProjectDrafts,
  describeProjectsSubmit,
  isProjectsReady,
  type ProjectDraft,
  resolveProjectChoices,
  resolveProjectsSignature,
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
  revise: (text: string, projects: OnboardingProjectChoice[]) => Promise<boolean>;
  open: (stepId: OnboardingStepId) => void;
  refresh: () => void;
  help: () => void;
}

export interface OnboardingAccountsView {
  list: AccountSummary[] | null;
  providers: ProviderLogin[];
  actions: OnboardingAccountActions;
  refresh: () => void;
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
            check: () => actions.answer(step.id, listChosenValues(step), ACCESS_KEY),
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
      <>
        <OnboardingProjects
          projects={step.projects}
          drafts={drafts.list}
          disabled={pending !== null}
          userHome={userHome}
          onChange={drafts.onChange}
        />
        {step.projects.length > 0 && (
          <OnboardingProjectsChat
            busy={pending === REVISE_KEY}
            disabled={pending !== null}
            onSend={(text) => actions.revise(text, resolveProjectChoices(step.projects, drafts.list))}
          />
        )}
        {step.filed.length > 0 && step.projects.length > 0 && (
          <SectionLabel className='-mb-2'>Already set up</SectionLabel>
        )}
        <OnboardingFiledProjects projects={step.filed} userHome={userHome} />
      </>
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
  if (step.id === 'defaults') {
    return (
      <OnboardingDefaults
        groups={step.groups}
        values={values}
        disabled={pending !== null}
        autoFocus={autoFocus}
        onChange={onChange}
      />
    );
  }
  if (step.id === 'accounts') {
    if (!isStepInstalled(step)) return <OnboardingChecks checks={step.checks} onRecheck={actions.refresh} />;
    return (
      <OnboardingAccounts
        accounts={accounts.list}
        providers={accounts.providers}
        actions={accounts.actions}
      />
    );
  }
  return (
    <>
      <OnboardingChecks checks={step.checks} onRecheck={actions.refresh} />
      {!step.ready && (
        <OnboardingHelp
          help={step.help}
          userHome={userHome}
          asking={pending === HELP_KEY}
          disabled={pending !== null}
          onAsk={actions.help}
          onRecheck={actions.refresh}
        />
      )}
    </>
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
    if (!isStepInstalled(step) || (accounts.list ?? []).length === 0) return null;
    return <OnboardingAddAccount actions={accounts.actions} />;
  }
  if (step.id !== 'prerequisites') return null;
  return (
    <Hint label='Check the tools again'>
      <Button
        variant='secondary'
        size='icon'
        icon='IconArrowRotateClockwise'
        aria-label='Check the tools again'
        loading={pending === REFRESH_KEY}
        onClick={actions.refresh}
      />
    </Hint>
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
  const installFirst = !isStepInstalled(step);
  const signInFirst = step.id === 'accounts' && !installFirst && !step.ready;
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
        <Button
          variant={signInFirst || installFirst ? 'secondary' : 'primary'}
          icon={{ name: 'IconArrowRight', position: 'inline-end' }}
          disabled={!(submit.ready && step.ready) || (pending !== null && pending !== SUBMIT_KEY)}
          loading={pending === SUBMIT_KEY}
          onClick={() => actions.answer(step.id, submit.values, SUBMIT_KEY, submit.projects)}
        >
          {submit.label}
        </Button>
      </div>
    </>
  );
}

export function OnboardingStepView({
  flow,
  step,
  pending,
  userHome,
  accounts,
  actions,
  onClose,
  autoFocus = true,
}: {
  flow: OnboardingFlow;
  step: OnboardingStep;
  pending: string | null;
  userHome: string;
  accounts: OnboardingAccountsView;
  actions: OnboardingStepActions;
  onClose?: () => void;
  autoFocus?: boolean;
}) {
  const [values, setValues] = React.useState(() => listChosenValues(step));
  const [drafts, setDrafts] = React.useState(() => createProjectDrafts(step.projects));
  const signature = resolveProjectsSignature(step.projects);
  const [draftedFor, setDraftedFor] = React.useState(signature);
  if (draftedFor !== signature) {
    setDraftedFor(signature);
    setDrafts(createProjectDrafts(step.projects));
  }
  const waiting = step.access.length > 0 || step.id === 'prerequisites' || step.id === 'accounts';
  useWindowReturn(() => {
    if (pending !== null) return;
    if (step.id === 'accounts') {
      accounts.refresh();
      actions.refresh();
    } else if (step.id === 'prerequisites') actions.refresh();
    else actions.answer(step.id, listChosenValues(step), ACCESS_KEY);
  }, waiting);
  return (
    <OnboardingSection
      title={step.title}
      description={step.description}
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
