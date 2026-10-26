import type { OnboardingFlow } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import { SettingRow, SettingsCard } from '@/components/settings/group.tsx';
import { listSetupSummary } from '@/lib/onboarding.ts';
import { OnboardingSection } from './section.tsx';

export function OnboardingFinished({ flow, onHome }: { flow: OnboardingFlow; onHome: () => void }) {
  const summary = listSetupSummary(flow);
  return (
    <>
      <div aria-hidden className='h-6.5' />
      <OnboardingSection
        title='Shinsa is ready'
        description='Start your first task from Home. You can change any of this in Settings.'
        direction='forward'
        footer={
          <>
            <span />
            <Button icon={{ name: 'IconArrowRight', position: 'inline-end' }} onClick={onHome}>
              Go to Home
            </Button>
          </>
        }
      >
        {summary.length > 0 && (
          <SettingsCard>
            {summary.map((entry) => (
              <SettingRow key={entry.id} title={entry.label}>
                <Truncate className='max-w-64 text-fg-3 text-xs'>{entry.summary}</Truncate>
              </SettingRow>
            ))}
          </SettingsCard>
        )}
      </OnboardingSection>
    </>
  );
}
