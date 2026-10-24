import type { OnboardingCheck } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { CARD } from '@/components/layout/surface/card.ts';
import { CheckOutcomeIcon } from '@/components/status/check-mark.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { resolveCheckOutcome } from '@/lib/onboarding.ts';

export function OnboardingChecks({ checks }: { checks: OnboardingCheck[] }) {
  return (
    <ul className={cn(CARD, 'flex flex-col gap-2.5 p-3')}>
      {checks.map((check) => (
        <li key={check.id} className='flex min-w-0 items-start gap-2'>
          <CheckOutcomeIcon outcome={resolveCheckOutcome(check)} />
          <span className='flex min-w-0 flex-1 flex-col gap-px'>
            <span className='text-fg-4 text-xs leading-4'>{check.label}</span>
            <span className='break-words text-2xs text-fg-2'>{check.detail}</span>
            {check.fix && (
              <span className='text-2xs text-fg-3'>
                <InlineMarkdown text={check.fix} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
