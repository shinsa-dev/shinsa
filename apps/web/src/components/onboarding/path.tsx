import type { OnboardingFlow, OnboardingStepId } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { StepMark } from '@/components/overview/progress-track.tsx';
import { describeStepPosition, listOnboardingPath } from '@/lib/onboarding.ts';

type PathItem = ReturnType<typeof listOnboardingPath>[number];

function PathStep({ item, onOpen }: { item: PathItem; onOpen: (stepId: OnboardingStepId) => void }) {
  const button = (
    <button
      type='button'
      disabled={item.disabled}
      aria-current={item.status === 'current' ? 'step' : undefined}
      onClick={() => onOpen(item.id)}
      className='-mx-1 flex w-fit items-center gap-1.5 rounded-item px-1 py-0.5 enabled:cursor-pointer enabled:active:bg-bg-a2 enabled:hover:bg-bg-a2'
    >
      <StepMark status={item.status} />
      <span
        className={cn(
          'whitespace-nowrap text-2xs',
          item.status === 'pending' ? 'text-fg-2' : 'text-fg-4',
          item.status === 'current' ? 'font-medium' : 'max-sm:hidden'
        )}
      >
        {item.label}
      </span>
    </button>
  );
  return (
    <li className='flex shrink-0'>{item.summary ? <Hint label={item.summary}>{button}</Hint> : button}</li>
  );
}

export function OnboardingPath({
  flow,
  onOpen,
}: {
  flow: OnboardingFlow;
  onOpen: (stepId: OnboardingStepId) => void;
}) {
  const items = listOnboardingPath(flow);
  return (
    <nav aria-label={`Setup, ${describeStepPosition(flow).toLowerCase()}`}>
      <ol className='flex w-full min-w-0 items-center gap-1.5'>
        {items.map((item, index) => (
          <React.Fragment key={item.id}>
            {index > 0 && (
              <span
                aria-hidden
                className={cn('h-px min-w-2 flex-1', item.status === 'pending' ? 'bg-bg-a3' : 'bg-green-4')}
              />
            )}
            <PathStep item={item} onOpen={onOpen} />
          </React.Fragment>
        ))}
      </ol>
    </nav>
  );
}
