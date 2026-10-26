import type { OnboardingCheck } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { SETTING_ROW, SettingsCard, TOKEN_TEXT } from '@/components/settings/group.tsx';
import { CheckOutcomeIcon } from '@/components/status/check-mark.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { resolveCheckOutcome } from '@/lib/onboarding.ts';

export function OnboardingChecks({ checks }: { checks: OnboardingCheck[] }) {
  return (
    <SettingsCard>
      <ul className='flex flex-col'>
        {checks.map((check) => (
          <li key={check.id} className={cn(SETTING_ROW, 'gap-2')}>
            <CheckOutcomeIcon outcome={resolveCheckOutcome(check)} className='size-3.5' />
            <span className='flex min-w-0 flex-1 flex-col gap-px'>
              <span className='text-fg-4 text-xs'>{check.label}</span>
              {check.fix && (
                <span className='text-2xs text-fg-3'>
                  <InlineMarkdown text={check.fix} />
                </span>
              )}
            </span>
            <Truncate className={cn(TOKEN_TEXT, 'min-w-0 max-w-1/2 shrink text-end')}>
              {check.detail}
            </Truncate>
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
