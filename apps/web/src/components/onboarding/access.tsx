import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { SETTING_ROW, SettingsCard } from '@/components/settings/group.tsx';
import { describeAccessTitle } from '@/lib/onboarding.ts';

export interface AccessActions {
  openSettings: () => void;
  check: () => void;
  leaveOut: () => void;
}

export function OnboardingAccess({
  access,
  userHome,
  checking,
  disabled,
  actions,
}: {
  access: string[];
  userHome: string;
  checking: boolean;
  disabled: boolean;
  actions: AccessActions;
}) {
  const many = access.length > 1;
  return (
    <SettingsCard>
      <div className={cn(SETTING_ROW, 'items-start gap-2 py-2.5')}>
        <Icon name='IconLock' size='sm' className='mt-px text-fg-3' />
        <div className='flex min-w-0 flex-1 flex-col gap-2'>
          <div className='flex flex-col gap-px'>
            <p className='text-fg-4 text-xs'>{describeAccessTitle(access, userHome)}</p>
            <p className='text-2xs text-fg-3'>
              Shinsa needs no other permission. To use {many ? 'these folders' : 'this folder'}, turn on
              Shinsa under Full Disk Access in System Settings. Shinsa checks again when you come back.
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-1.5'>
            <Button
              variant='outline'
              size='sm'
              icon='IconArrowUpRight'
              disabled={disabled}
              onClick={actions.openSettings}
            >
              Open System Settings
            </Button>
            <Button
              variant='secondary'
              size='sm'
              icon='IconArrowRotateClockwise'
              loading={checking}
              disabled={disabled && !checking}
              onClick={actions.check}
            >
              Check again
            </Button>
            <Button variant='secondary' size='sm' disabled={disabled} onClick={actions.leaveOut}>
              {many ? 'Leave them out' : 'Leave it out'}
            </Button>
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}
