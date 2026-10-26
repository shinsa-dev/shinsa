import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { cn } from '@shinsa/ui/lib/utils';
import { PageScroll } from '@/components/layout/page/page-scroll.tsx';
import { OnboardingFinished } from '@/components/onboarding/finished.tsx';
import { ONBOARDING_COLUMN, OnboardingStepView } from '@/components/onboarding/step.tsx';
import { LoadingSpinner } from '@/components/status/loading-line.tsx';
import { useOnboardingFlow } from '@/hooks/use-onboarding-flow.ts';
import { removeAccount, startSignIn, useAccounts } from '@/lib/connection/accounts.ts';
import { useOnboardingStatus } from '@/lib/connection/onboarding.ts';
import { navigate } from '@/router.ts';

const ACCOUNT_ACTIONS = {
  signIn: (accountId: string | null) => void startSignIn(accountId),
  remove: (accountId: string) => void removeAccount(accountId),
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
  if (!flow.step) return <OnboardingFinished flow={flow} onHome={() => navigate('/')} />;
  return (
    <OnboardingStepView
      key={`${flow.index}:${flow.step.id}`}
      flow={flow}
      step={flow.step}
      pending={pending}
      direction={direction}
      userHome={status?.paths.userHome ?? ''}
      accounts={{ list: accounts?.accounts ?? [], actions: ACCOUNT_ACTIONS }}
      actions={{
        answer: (stepId, values, key) => void answer(stepId, values, key),
        open: (stepId) => void open(stepId),
        refresh: () => void refresh(),
      }}
      onClose={flow.revisit ? () => navigate('/settings') : undefined}
    />
  );
}

export function OnboardingPage() {
  return (
    <PageScroll>
      <div className={cn(ONBOARDING_COLUMN, 'pt-8 pb-16 md:pt-16')}>
        <OnboardingContent />
      </div>
    </PageScroll>
  );
}
