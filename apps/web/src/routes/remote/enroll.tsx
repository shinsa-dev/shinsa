import { REMOTE_PATHS, resolveKeyFingerprint } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import * as React from 'react';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { SettingsCard } from '@/components/settings/group.tsx';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { DeviceStore } from '@/lib/remote/devices.ts';
import { type EnrollInput, enrollDevice } from '@/lib/remote/enroll.ts';
import { clearEnrollFragment } from '@/lib/remote/mode.ts';
import { RemoteHero } from './shell.tsx';

const ENROLL_POINTS: { icon: IconName; title: string; detail: string }[] = [
  {
    icon: 'IconKey1',
    title: 'A key made for this browser',
    detail: 'It stays on this device and cannot be copied out of it.',
  },
  {
    icon: 'IconShieldCheck',
    title: 'Encrypted end to end',
    detail: 'Only this browser and your Mac can read what passes between them.',
  },
  {
    icon: 'IconLock',
    title: 'Once per browser',
    detail: 'After this, signing in with GitHub is all it takes.',
  },
];

type EnrollState = { kind: 'ready' } | { kind: 'enrolling' } | { kind: 'failed'; message: string };

export function EnrollPage({
  link,
  dashboard,
  devices,
  enroll = enrollDevice,
}: {
  link: EnrollInput | null;
  dashboard: Pick<DashboardClient, 'requestConnect'>;
  devices: Pick<DeviceStore, 'writeDevice'>;
  enroll?: typeof enrollDevice;
}) {
  const [state, setState] = React.useState<EnrollState>({ kind: 'ready' });
  const [fingerprint, setFingerprint] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (link) void resolveKeyFingerprint(link.machineKey).then(setFingerprint);
  }, [link]);
  if (!link)
    return (
      <section className='flex flex-col gap-4'>
        <PageHeading
          title='This link cannot add a browser'
          description='It is incomplete or was already used. On your Mac, open Settings, Remote access and choose Add device for a new one.'
        />
        <div className='flex'>
          <Button nativeButton={false} variant='outline' render={<a href={REMOTE_PATHS.app} />}>
            Open Shinsa
          </Button>
        </div>
      </section>
    );
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon='IconMacbook' title='Add this browser to your Mac'>
        Once it is added, this browser opens Shinsa on your Mac from anywhere.
      </RemoteHero>
      <SettingsCard className='w-full'>
        {ENROLL_POINTS.map((point) => (
          <div key={point.title} className='flex gap-3 px-2.5 py-2'>
            <Icon name={point.icon} size='sm' className='mt-px shrink-0 text-fg-2' />
            <div className='flex min-w-0 flex-col gap-px'>
              <span className='text-fg-4 text-xs'>{point.title}</span>
              <span className='text-pretty text-2xs text-fg-2'>{point.detail}</span>
            </div>
          </div>
        ))}
      </SettingsCard>
      {state.kind === 'failed' && (
        <p role='alert' className='w-full text-destructive text-xs'>
          {state.message}
        </p>
      )}
      <div className='flex w-full flex-col items-center gap-2'>
        <Button
          className='w-full'
          loading={state.kind === 'enrolling'}
          onClick={() => {
            setState({ kind: 'enrolling' });
            enroll(link, { dashboard, devices }).then(
              () => {
                clearEnrollFragment(sessionStorage);
                location.assign(REMOTE_PATHS.app);
              },
              (error: unknown) => setState({ kind: 'failed', message: (error as Error).message })
            );
          }}
        >
          Add this browser
        </Button>
        <p className='text-2xs text-fg-2'>
          Mac key: <span className='font-mono'>{fingerprint ?? '…'}</span>
        </p>
      </div>
    </section>
  );
}
