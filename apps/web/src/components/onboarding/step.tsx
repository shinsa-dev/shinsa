import type { AccountSummary, OnboardingFlow, OnboardingStep, OnboardingStepId } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Input } from '@shinsa/ui/components/input';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ErrorLine } from '@/components/chat/turn-detail.tsx';
import { type OnboardingAccountActions, OnboardingAccounts } from '@/components/onboarding/accounts.tsx';
import { OnboardingChecks } from '@/components/onboarding/checks.tsx';
import { OptionList } from '@/components/onboarding/options.tsx';
import { OnboardingSection } from '@/components/onboarding/section.tsx';
import { SETTING_ROW } from '@/components/settings/group.tsx';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import {
  listChosenValues,
  REFRESH_KEY,
  resolveFolderOptions,
  resolveSubmitValues,
  resolveToggledRoots,
  type StepDirection,
  SUBMIT_KEY,
} from '@/lib/onboarding.ts';

export const ONBOARDING_COLUMN = 'mx-auto flex w-full max-w-xl flex-col gap-6 px-6';

export interface OnboardingStepActions {
  answer: (stepId: OnboardingStepId, values: string[], key?: string) => void;
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
  busy,
  autoFocus,
}: {
  step: OnboardingStep;
  userHome: string;
  values: string[];
  onChange: (values: string[]) => void;
  busy: boolean;
  autoFocus: boolean;
}) {
  const [typed, setTyped] = React.useState<string[]>([]);
  const options = resolveFolderOptions(step.options, typed, userHome);
  return (
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
  );
}

function StepBody({
  step,
  values,
  pending,
  userHome,
  accounts,
  actions,
  onChange,
  autoFocus,
}: {
  step: OnboardingStep;
  values: string[];
  pending: string | null;
  userHome: string;
  accounts: OnboardingAccountsView;
  actions: OnboardingStepActions;
  onChange: (values: string[]) => void;
  autoFocus: boolean;
}) {
  if (step.id === 'roots') {
    return (
      <FoldersBody
        step={step}
        userHome={userHome}
        values={values}
        onChange={onChange}
        busy={pending !== null}
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

function StepFooter({
  flow,
  step,
  values,
  pending,
  accounts,
  actions,
  onClose,
}: {
  flow: OnboardingFlow;
  step: OnboardingStep;
  values: string[];
  pending: string | null;
  accounts: OnboardingAccountsView;
  actions: OnboardingStepActions;
  onClose?: () => void;
}) {
  const previous = flow.steps[flow.index - 1];
  const submitValues = resolveSubmitValues(step, values);
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
            disabled={submitValues.length === 0 || (pending !== null && pending !== SUBMIT_KEY)}
            loading={pending === SUBMIT_KEY}
            onClick={() => actions.answer(step.id, submitValues)}
          >
            {step.submitLabel}
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
        onChange={setValues}
        autoFocus={autoFocus}
      />
      {step.problem && <ErrorLine text={step.problem} />}
    </OnboardingSection>
  );
}
