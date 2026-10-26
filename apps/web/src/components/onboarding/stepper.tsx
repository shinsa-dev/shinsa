import type { OnboardingFlow, OnboardingStep, OnboardingStepId } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { Choice } from '@/components/controls/choice.tsx';
import { PAGE_DESCRIPTION } from '@/components/layout/page/heading.tsx';
import { describeStepHeading, describeStepPosition, listStepperItems } from '@/lib/onboarding.ts';

export function OnboardingStepper({
  flow,
  step,
  onOpen,
}: {
  flow: OnboardingFlow;
  step: OnboardingStep;
  onOpen: (stepId: OnboardingStepId) => void;
}) {
  const position = describeStepPosition(flow);
  return (
    <nav aria-label={`Setup, ${position.toLowerCase()}`} className='flex h-6.5 items-center'>
      <Choice<OnboardingStepId>
        label='Setup steps'
        items={listStepperItems(flow)}
        value={step.id}
        onValueChange={onOpen}
        className='max-sm:hidden'
      />
      <p className={cn(PAGE_DESCRIPTION, 'sm:hidden')}>{describeStepHeading(flow)}</p>
    </nav>
  );
}
