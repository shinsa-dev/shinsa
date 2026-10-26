import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import type { StepDirection } from '@/lib/onboarding.ts';

export function OnboardingSection({
  title,
  description,
  direction,
  footer,
  children,
}: {
  title: string;
  description: string;
  direction: StepDirection;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn('flex flex-col gap-6', direction === 'back' ? 'onboarding-in-back' : 'onboarding-in')}
    >
      <div className='flex flex-col gap-4'>
        <PageHeading title={title} description={description} />
        {children}
      </div>
      <div className='flex items-center justify-between gap-3'>{footer}</div>
    </section>
  );
}
