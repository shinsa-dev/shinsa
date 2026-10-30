import { REMOTE_PATHS, resolveKeyFingerprint } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { SettingRow, SettingsCard } from '@/components/settings/group.tsx';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { DeviceStore } from '@/lib/remote/devices.ts';
import { type EnrollInput, enrollDevice } from '@/lib/remote/enroll.ts';
import { clearEnrollFragment } from '@/lib/remote/mode.ts';

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
    <section className='flex flex-col gap-4'>
      <PageHeading
        title='Add this browser to your Mac'
        description='This browser makes its own key, kept on this device only, and your Mac remembers it. Everything between them is encrypted end to end, so shinsa.dev/app and Cloudflare cannot read it.'
      />
      <SettingsCard>
        <SettingRow title='Mac fingerprint'>
          <span className='font-mono text-fg-3 text-xs'>{fingerprint ?? '…'}</span>
        </SettingRow>
      </SettingsCard>
      {state.kind === 'failed' && (
        <p role='alert' className='text-destructive text-xs'>
          {state.message}
        </p>
      )}
      <div>
        <Button
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
      </div>
    </section>
  );
}
