import type { OnboardingFlow } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { CARD } from '@/components/layout/surface/card.ts';
import { listSetupSummary } from '@/lib/onboarding.ts';

export function OnboardingFinished({ flow, onHome }: { flow: OnboardingFlow; onHome: () => void }) {
  const summary = listSetupSummary(flow);
  return (
    <section className='onboarding-in flex flex-col gap-6'>
      <span className='corner-superellipse/1.125 grid size-10 place-items-center rounded-xl bg-bg-a2 text-primary-text'>
        <Icon name='IconCheckmark1' size='lg' />
      </span>
      <div className='flex flex-col gap-1.5'>
        <h1 className='text-balance font-medium text-fg-4 text-lg leading-tight'>Shinsa is ready</h1>
        <p className='text-pretty text-fg-2 text-sm'>
          Start your first task from Home. You can change any of this in Settings.
        </p>
      </div>
      {summary.length > 0 && (
        <dl className={cn(CARD, 'flex flex-col overflow-hidden')}>
          {summary.map((entry) => (
            <div
              key={entry.id}
              className='flex min-h-10 items-center gap-3 border-border not-first:border-t px-3.5 py-2'
            >
              <dt className='w-24 shrink-0 text-fg-2 text-xs'>{entry.label}</dt>
              <dd className='min-w-0 truncate text-fg-4 text-sm'>{entry.summary}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className='flex justify-end border-border border-t pt-4'>
        <Button icon={{ name: 'IconArrowRight', position: 'inline-end' }} onClick={onHome}>
          Go to Home
        </Button>
      </div>
    </section>
  );
}
