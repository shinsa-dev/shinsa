import type { AccountSummary, OnboardingFlow, OnboardingStep, OnboardingStepId } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Input } from '@shinsa/ui/components/input';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ErrorLine } from '@/components/chat/turn-detail.tsx';
import { type OnboardingAccountActions, OnboardingAccounts } from '@/components/onboarding/accounts.tsx';
import { OnboardingChecks } from '@/components/onboarding/checks.tsx';
import { OptionList } from '@/components/onboarding/options.tsx';
import { OnboardingStepper } from '@/components/onboarding/stepper.tsx';
import {
  listChosenValues,
  REFRESH_KEY,
  resolveFolderOptions,
  resolveSubmitValues,
  resolveToggledRoots,
  type StepDirection,
  SUBMIT_KEY,
} from '@/lib/onboarding.ts';

export const ONBOARDING_COLUMN = 'mx-auto flex w-full max-w-xl flex-col px-6';

export interface OnboardingStepActions {
  answer: (stepId: OnboardingStepId, values: string[], key?: string) => void;
  open: (stepId: OnboardingStepId) => void;
  refresh: () => void;
}

export interface OnboardingAccountsView {
  list: AccountSummary[];
  actions: OnboardingAccountActions;
}

function StepHeading({ step }: { step: OnboardingStep }) {
  return (
    <div className='flex flex-col gap-1.5'>
      <h1 className='text-balance font-medium text-fg-4 text-lg leading-tight'>{step.title}</h1>
      <p className='text-pretty text-fg-2 text-sm'>{step.description}</p>
    </div>
  );
}

function AddFolderField({ onAdd }: { onAdd: (path: string) => void }) {
  const [path, setPath] = React.useState('');
  const trimmed = path.trim();
  return (
    <form
      className='flex items-center gap-2'
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed) return;
        onAdd(trimmed);
        setPath('');
      }}
    >
      <Input
        value={path}
        onChange={(event) => setPath(event.target.value)}
        placeholder='Add a folder by its path, like ~/code'
        aria-label='Folder path'
        spellCheck={false}
        autoComplete='off'
      />
      <Button type='submit' variant='outline' icon='IconPlusMedium' disabled={!trimmed}>
        Add
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
    <div className='flex flex-col gap-3'>
      {options.length > 0 && (
        <OptionList
          options={options}
          values={values}
          multiple
          label='Folders'
          busyValue={null}
          disabled={busy}
          autoFocus={autoFocus}
          onPick={(value) => onChange(resolveToggledRoots(values, value))}
        />
      )}
      <AddFolderField
        onAdd={(path) => {
          setTyped([...typed, path]);
          if (!values.includes(path)) onChange([...values, path]);
        }}
      />
    </div>
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
    return (
      <OnboardingChecks
        checks={step.checks}
        footer={
          <Button
            variant='outline'
            size='sm'
            icon='IconArrowRotateClockwise'
            loading={pending === REFRESH_KEY}
            onClick={actions.refresh}
          >
            Check again
          </Button>
        }
      />
    );
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

function StepFooter({
  flow,
  step,
  values,
  pending,
  actions,
  onClose,
}: {
  flow: OnboardingFlow;
  step: OnboardingStep;
  values: string[];
  pending: string | null;
  actions: OnboardingStepActions;
  onClose?: () => void;
}) {
  const previous = flow.steps[flow.index - 1];
  const submitValues = resolveSubmitValues(step, values);
  const choosing = step.options.length > 0 && !step.multiple;
  return (
    <div className='flex items-center justify-between gap-3 border-border border-t pt-4'>
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
      <div className='flex items-center gap-2'>
        {onClose && (
          <Button variant='secondary' onClick={onClose}>
            Close setup
          </Button>
        )}
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
    </div>
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
    <div className='flex flex-col gap-10'>
      <OnboardingStepper flow={flow} disabled={pending !== null} onOpen={actions.open} />
      <section
        className={cn('flex flex-col gap-6', direction === 'back' ? 'onboarding-in-back' : 'onboarding-in')}
      >
        <StepHeading step={step} />
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
        <StepFooter
          flow={flow}
          step={step}
          values={values}
          pending={pending}
          actions={actions}
          onClose={onClose}
        />
      </section>
    </div>
  );
}
