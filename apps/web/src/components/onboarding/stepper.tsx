import type { OnboardingFlow, OnboardingStepEntry, OnboardingStepId } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { describeStepPosition, resolveStepState, type StepState } from '@/lib/onboarding.ts';

const MARK: Record<StepState, string> = {
  done: 'bg-bg-a2 text-primary-text',
  current: 'bg-primary-4 text-primary-foreground',
  ahead: 'bg-bg-a2 text-fg-3',
  upcoming: 'bg-bg-a1 text-fg-2',
};

const LABEL: Record<StepState, string> = {
  done: 'text-fg-3',
  current: 'faux-medium text-fg-4',
  ahead: 'text-fg-3',
  upcoming: 'text-fg-2',
};

function StepItem({
  entry,
  index,
  state,
  disabled,
  onOpen,
}: {
  entry: OnboardingStepEntry;
  index: number;
  state: StepState;
  disabled: boolean;
  onOpen: (stepId: OnboardingStepId) => void;
}) {
  const content = (
    <>
      <span
        className={cn(
          'corner-superellipse/1.125 grid size-5 shrink-0 place-items-center rounded-full font-medium text-2xs tabular-nums',
          MARK[state]
        )}
      >
        {state === 'done' ? <Icon name='IconCheckmark1Small' size='sm' /> : index + 1}
      </span>
      <span className={cn('text-xs', LABEL[state], state !== 'current' && 'max-sm:sr-only')}>
        {entry.label}
      </span>
    </>
  );
  const openable = state === 'done' || state === 'ahead';
  if (!openable) {
    return (
      <li
        aria-current={state === 'current' ? 'step' : undefined}
        className='flex shrink-0 items-center gap-1.5'
      >
        {content}
      </li>
    );
  }
  const button = (
    <button
      type='button'
      disabled={disabled}
      onClick={() => onOpen(entry.id)}
      aria-label={entry.summary ? `${entry.label}: ${entry.summary}` : entry.label}
      className='-mx-1 flex w-fit cursor-pointer items-center gap-1.5 rounded-control-sm px-1 py-0.5 outline-none hover:bg-bg-a1 active:bg-bg-a1 disabled:cursor-default'
    >
      {content}
    </button>
  );
  return (
    <li className='flex shrink-0 items-center'>
      {entry.summary ? (
        <Hint label={entry.summary} side='bottom'>
          {button}
        </Hint>
      ) : (
        button
      )}
    </li>
  );
}

export function OnboardingStepper({
  flow,
  disabled,
  onOpen,
}: {
  flow: OnboardingFlow;
  disabled: boolean;
  onOpen: (stepId: OnboardingStepId) => void;
}) {
  return (
    <nav aria-label={`Setup, ${describeStepPosition(flow).toLowerCase()}`}>
      <ol className='flex items-center gap-2'>
        {flow.steps.map((entry, index) => (
          <React.Fragment key={entry.id}>
            {index > 0 && <li aria-hidden className='h-px min-w-2 flex-1 bg-border' />}
            <StepItem
              entry={entry}
              index={index}
              state={resolveStepState(entry, index, flow.index)}
              disabled={disabled}
              onOpen={onOpen}
            />
          </React.Fragment>
        ))}
      </ol>
    </nav>
  );
}
