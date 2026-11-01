import type { OnboardingFlow, OnboardingStepId } from '@shinsa/core';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { OnboardingPath } from '@/components/onboarding/path.tsx';

export function OnboardingHeader({
  flow,
  onOpen,
}: {
  flow: OnboardingFlow;
  onOpen: (stepId: OnboardingStepId) => void;
}) {
  return (
    <div className='flex flex-col gap-4 border-border border-b pb-5'>
      <PageHeading
        title='Set up Shinsa'
        description={
          flow.revisit
            ? 'Open any step to change it. Each one saves as you go.'
            : 'Your first task. Pass each step below and Shinsa is ready for real work.'
        }
      />
      <OnboardingPath flow={flow} onOpen={onOpen} />
    </div>
  );
}
