import type { OnboardingCheck } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { CARD } from '@/components/layout/surface/card.ts';
import { CheckOutcomeIcon } from '@/components/status/check-mark.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { resolveCheckOutcome } from '@/lib/onboarding.ts';

export function OnboardingChecks({
  checks,
  footer,
}: {
  checks: OnboardingCheck[];
  footer?: React.ReactNode;
}) {
  return (
    <div className={cn(CARD, 'flex flex-col overflow-hidden')}>
      <ul className='flex flex-col'>
        {checks.map((check) => (
          <li
            key={check.id}
            className='flex min-w-0 items-start gap-3 border-border not-first:border-t px-3.5 py-2.5'
          >
            <CheckOutcomeIcon outcome={resolveCheckOutcome(check)} className='h-5' />
            <span className='flex min-w-0 flex-1 flex-col gap-px'>
              <span className='flex min-w-0 items-baseline gap-3'>
                <span className='shrink-0 text-fg-4 text-sm'>{check.label}</span>
                <Truncate className='ms-auto min-w-0 text-end text-fg-2 text-xs'>{check.detail}</Truncate>
              </span>
              {check.fix && (
                <span className='text-fg-3 text-xs'>
                  <InlineMarkdown text={check.fix} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {footer && (
        <div className='flex items-center border-border border-t bg-bg-a1 px-3.5 py-2.5'>{footer}</div>
      )}
    </div>
  );
}
