import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import type { StepDirection } from '@/lib/onboarding.ts';

interface ShownStep {
  key: string;
  node: React.ReactNode;
  direction: StepDirection;
}

const ENTER_CLASS: Record<StepDirection, string | null> = {
  none: null,
  forward: 'onboarding-in',
  back: 'onboarding-in-back',
};

const LEAVE_CLASS: Record<StepDirection, string> = {
  none: 'onboarding-out',
  forward: 'onboarding-out',
  back: 'onboarding-out-back',
};

export function OnboardingTrack({
  stepKey,
  direction,
  children,
}: {
  stepKey: string;
  direction: StepDirection;
  children: React.ReactNode;
}) {
  const shown = React.useRef<ShownStep>({ key: stepKey, node: children, direction });
  const [leaving, setLeaving] = React.useState<ShownStep | null>(null);

  React.useLayoutEffect(() => {
    if (shown.current.key !== stepKey) setLeaving({ ...shown.current, direction });
    shown.current = { key: stepKey, node: children, direction };
  });

  return (
    <div className='onboarding-track -mx-6 grid overflow-x-clip px-6'>
      {leaving && leaving.key !== stepKey && (
        <div
          key={leaving.key}
          inert
          className={cn('[grid-area:1/1]', LEAVE_CLASS[leaving.direction])}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setLeaving(null);
          }}
        >
          {leaving.node}
        </div>
      )}
      <div key={stepKey} className={cn('[grid-area:1/1]', ENTER_CLASS[direction])}>
        {children}
      </div>
    </div>
  );
}
