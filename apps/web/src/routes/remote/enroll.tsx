import { DEVICE_NAME_LIMIT, REMOTE_PATHS, type RemoteUser, resolveKeyFingerprint } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Field } from '@shinsa/ui/components/field';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import * as React from 'react';
import { SettingsCard } from '@/components/settings/group.tsx';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import { resolveDeviceName } from '@/lib/remote/device-name.ts';
import type { DeviceStore } from '@/lib/remote/devices.ts';
import { type EnrollInput, requestDeviceAccess } from '@/lib/remote/enroll.ts';
import { clearEnrollFragment, MACHINE_ICON } from '@/lib/remote/mode.ts';
import { RemoteBenefits, RemoteHero, RemoteLoading } from './shell.tsx';

const ENROLL_POINTS: { icon: IconName; title: string; detail: string }[] = [
  {
    icon: 'IconKey1',
    title: 'A key made for this device',
    detail: 'It stays on this device and cannot be copied out of it.',
  },
  {
    icon: 'IconShieldCheck',
    title: 'Encrypted end to end',
    detail: 'Only this device and the machine can read what passes between them.',
  },
  {
    icon: 'IconLock',
    title: 'Accepted on the machine',
    detail: 'Nothing opens until someone with access to the machine accepts this request.',
  },
];

type EnrollState =
  | { kind: 'ready' }
  | { kind: 'requesting' }
  | { kind: 'waiting' }
  | { kind: 'failed'; message: string };

function resolveBrowserDeviceName(invitee: RemoteUser | null) {
  return resolveDeviceName(navigator.userAgent, navigator.maxTouchPoints > 1, invitee);
}

function WaitingNote({ joining }: { joining: boolean }) {
  return (
    <p role='status' className='w-full text-pretty text-fg-2 text-xs'>
      {joining
        ? 'Request sent. Once it is accepted, the machine shows up in Shinsa Cloud. You can close this page.'
        : 'Request sent. Accept it in Settings > Remote access on the machine. You can close this page.'}
    </p>
  );
}

function useJoining(link: EnrollInput | null, dashboard: Pick<DashboardClient, 'listInstances'>) {
  const [joining, setJoining] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!link) return;
    let live = true;
    dashboard.listInstances().then(
      (instances) => {
        if (live) setJoining(!instances.some((instance) => instance.id === link.instanceId));
      },
      () => {
        if (live) setJoining(true);
      }
    );
    return () => {
      live = false;
    };
  }, [link, dashboard]);
  return joining;
}

export function EnrollPage({
  link,
  user,
  dashboard,
  devices,
  request = requestDeviceAccess,
  resolveName = resolveBrowserDeviceName,
}: {
  link: EnrollInput | null;
  user: RemoteUser;
  dashboard: Pick<DashboardClient, 'acceptInvite' | 'listInstances'>;
  devices: Pick<DeviceStore, 'writeDevice'>;
  request?: typeof requestDeviceAccess;
  resolveName?: (invitee: RemoteUser | null) => string;
}) {
  const [state, setState] = React.useState<EnrollState>({ kind: 'ready' });
  const [fingerprint, setFingerprint] = React.useState<string | null>(null);
  const joining = useJoining(link, dashboard);
  const [edited, setEdited] = React.useState<string | null>(null);
  const name = edited ?? resolveName(joining ? user : null);
  React.useEffect(() => {
    if (link) void resolveKeyFingerprint(link.machineKey).then(setFingerprint);
  }, [link]);
  if (!link)
    return (
      <section className='flex flex-col items-center gap-6 pt-4'>
        <RemoteHero icon='IconCircleX' tone='red' title='This link cannot add a device'>
          {'It is incomplete. On the machine, open Settings > Remote access and copy its invite link again.'}
        </RemoteHero>
        <RemoteBenefits />
        <Button
          className='w-full'
          variant='secondary'
          nativeButton={false}
          render={<a href={REMOTE_PATHS.app} />}
        >
          Open Shinsa
        </Button>
      </section>
    );
  if (joining === null) return <RemoteLoading label='Reading the link' />;
  const busy = state.kind === 'requesting' || state.kind === 'waiting';
  const submit = () => {
    setState({ kind: 'requesting' });
    request(link, {
      dashboard,
      devices,
      name: name.trim(),
      onPending: () => setState({ kind: 'waiting' }),
    }).then(
      () => {
        clearEnrollFragment(sessionStorage);
        location.assign(REMOTE_PATHS.app);
      },
      (error: unknown) => setState({ kind: 'failed', message: (error as Error).message })
    );
  };
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      {joining ? (
        <RemoteHero icon='IconUserAdd' title='Join a shared machine'>
          Ask for access with your GitHub account. Once the machine’s owner accepts, this device has full
          control of that machine from anywhere.
        </RemoteHero>
      ) : (
        <RemoteHero icon={MACHINE_ICON} title='Add this device to your machine'>
          Name this device and ask for access. Once you accept it, this device opens Shinsa on your machine
          from anywhere.
        </RemoteHero>
      )}
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
      <form
        className='flex w-full flex-col items-center gap-2'
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && !busy) submit();
        }}
      >
        <Field className='w-full'>
          <Input
            value={name}
            aria-label='Device name'
            maxLength={DEVICE_NAME_LIMIT}
            disabled={busy}
            onChange={(event) => setEdited(event.target.value)}
          />
        </Field>
        {state.kind === 'failed' && (
          <p role='alert' className='w-full text-destructive text-xs'>
            {state.message}
          </p>
        )}
        {state.kind === 'waiting' && <WaitingNote joining={joining} />}
        <Button type='submit' className='w-full' loading={busy} disabled={!name.trim()}>
          Request access
        </Button>
        <p className='text-2xs text-fg-2'>
          Machine key: <span className='font-mono'>{fingerprint ?? '…'}</span>
        </p>
      </form>
    </section>
  );
}
