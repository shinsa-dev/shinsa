import type { OnboardingStepId } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { cn } from '@shinsa/ui/lib/utils';
import { PAGE_TOP } from '@/components/layout/page/column.ts';
import { PageScroll } from '@/components/layout/page/page-scroll.tsx';
import { OnboardingFinished } from '@/components/onboarding/finished.tsx';
import { ONBOARDING_COLUMN, OnboardingStepView } from '@/components/onboarding/step.tsx';
import { OnboardingStepper } from '@/components/onboarding/stepper.tsx';
import { OnboardingTrack } from '@/components/onboarding/track.tsx';
import { LoadingSpinner } from '@/components/status/loading-line.tsx';
import { useOnboardingFlow } from '@/hooks/use-onboarding-flow.ts';
import { refreshUsage, removeAccount, startSignIn, useAccounts } from '@/lib/connection/accounts.ts';
import { copyText } from '@/lib/connection/commands.ts';
import { requestPrivacySettings, useOnboardingStatus } from '@/lib/connection/onboarding.ts';
import { navigate } from '@/router.ts';

const ACCOUNT_ACTIONS = {
  signIn: (accountId: string | null) => void startSignIn(accountId),
  remove: (accountId: string) => void removeAccount(accountId),
  copy: (text: string) => void copyText(text),
};

function OnboardingContent() {
  const { flow, failure, pending, direction, answer, open, refresh, retry } = useOnboardingFlow();
  const accounts = useAccounts();
  const status = useOnboardingStatus();
  if (failure) {
    return (
      <EmptyState
        icon='IconExclamationCircle'
        title='Setup could not load'
        description={failure}
        className='min-h-80'
      >
        <Button variant='outline' size='sm' onClick={retry}>
          Try again
        </Button>
      </EmptyState>
    );
  }
  if (!flow) {
    return (
      <div className='grid min-h-80 place-items-center'>
        <LoadingSpinner label='Reading the setup' />
      </div>
    );
  }
  const openStep = (stepId: OnboardingStepId) => {
    if (pending === null) void open(stepId);
  };
  const { step } = flow;
  return (
    <>
      {step ? (
        <OnboardingStepper flow={flow} step={step} onOpen={openStep} />
      ) : (
        <div aria-hidden className='h-6.5' />
      )}
      <OnboardingTrack stepKey={step ? `${flow.index}:${step.id}` : 'finished'} direction={direction}>
        {step ? (
          <OnboardingStepView
            flow={flow}
            step={step}
            pending={pending}
            userHome={status?.paths.userHome ?? ''}
            accounts={{
              list: accounts?.accounts ?? null,
              providers: accounts?.providers ?? [],
              actions: ACCOUNT_ACTIONS,
              refresh: () => void refreshUsage(),
            }}
            actions={{
              answer: (stepId, values, key, projects) => void answer(stepId, values, key, projects),
              open: openStep,
              refresh: () => void refresh(),
              openPrivacy: () => void requestPrivacySettings(),
            }}
            onClose={flow.revisit ? () => navigate('/settings') : undefined}
          />
        ) : (
          <OnboardingFinished flow={flow} onHome={() => navigate('/')} />
        )}
      </OnboardingTrack>
    </>
  );
}

export function OnboardingPage() {
  return (
    <PageScroll>
      <div className={cn(ONBOARDING_COLUMN, PAGE_TOP, 'pb-16 md:pt-12')}>
        <OnboardingContent />
      </div>
    </PageScroll>
  );
}
