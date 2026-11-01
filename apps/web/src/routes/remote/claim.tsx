import { REMOTE_PATHS, type RemoteInstance, type RemoteUser } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import { resolveDeviceName } from '@/lib/remote/device-name.ts';
import type { DeviceStore } from '@/lib/remote/devices.ts';
import { claimHandoff, type EnrollInput, resolveClaimStanding } from '@/lib/remote/enroll.ts';
import { CLAIM_POINTS, clearEnrollFragment, MACHINE_ICON } from '@/lib/remote/mode.ts';
import { RemoteBenefits, RemoteHero, RemoteLoading } from './shell.tsx';

type ClaimState = { kind: 'ready' } | { kind: 'claiming' } | { kind: 'failed'; message: string };

type Standing = ReturnType<typeof resolveClaimStanding>;

function resolveBrowserDeviceName(user: RemoteUser) {
  return resolveDeviceName(navigator.userAgent, navigator.maxTouchPoints > 1, user);
}

function useStanding(
  link: EnrollInput | null,
  dashboard: Pick<DashboardClient, 'listInstances'>,
  devices: Pick<DeviceStore, 'selectDevice'>
) {
  const [standing, setStanding] = React.useState<Standing | null>(null);
  React.useEffect(() => {
    if (!link) return;
    let live = true;
    const instances = dashboard.listInstances().catch((): RemoteInstance[] => []);
    const device = devices.selectDevice(link.instanceId).catch(() => null);
    void Promise.all([instances, device]).then(([listed, earlier]) => {
      if (live) setStanding(resolveClaimStanding(link, listed, earlier));
    });
    return () => {
      live = false;
    };
  }, [link, dashboard, devices]);
  return standing;
}

function OpenShinsa({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  return (
    <Button className='w-full' variant={variant} nativeButton={false} render={<a href={REMOTE_PATHS.app} />}>
      Open Shinsa
    </Button>
  );
}

export function ClaimPage({
  link,
  user,
  dashboard,
  devices,
  claim = claimHandoff,
  resolveName = resolveBrowserDeviceName,
}: {
  link: EnrollInput | null;
  user: RemoteUser;
  dashboard: Pick<DashboardClient, 'acceptHandoff' | 'listInstances'>;
  devices: Pick<DeviceStore, 'writeDevice' | 'selectDevice'>;
  claim?: typeof claimHandoff;
  resolveName?: (user: RemoteUser) => string;
}) {
  const [state, setState] = React.useState<ClaimState>({ kind: 'ready' });
  const standing = useStanding(link, dashboard, devices);
  if (!link)
    return (
      <section className='flex flex-col items-center gap-6 pt-4'>
        <RemoteHero icon='IconCircleX' tone='red' title='This link cannot hand over a task'>
          It is incomplete. Ask the task’s owner to copy its hand-off link again.
        </RemoteHero>
        <OpenShinsa variant='secondary' />
      </section>
    );
  if (!standing) return <RemoteLoading label='Reading the link' />;
  if (standing.kind === 'added')
    return (
      <section className='flex flex-col items-center gap-6 pt-4'>
        <RemoteHero
          icon={MACHINE_ICON}
          tone='green'
          title={`This device already reaches ${standing.machine}`}
        >
          You can open every task there already. Leave the link for the person taking this task over.
        </RemoteHero>
        <OpenShinsa />
      </section>
    );
  if (standing.kind === 'busy')
    return (
      <section className='flex flex-col items-center gap-6 pt-4'>
        <RemoteHero icon='IconCircleX' tone='amber' title='This browser works on a task from there already'>
          {`A browser takes over one task from ${standing.machine}. Open this link in another browser or profile to take this one over too.`}
        </RemoteHero>
        <OpenShinsa variant='secondary' />
      </section>
    );
  const take = () => {
    setState({ kind: 'claiming' });
    claim(link, { dashboard, devices, name: resolveName(user) }).then(
      () => {
        clearEnrollFragment(sessionStorage);
        location.assign(REMOTE_PATHS.app);
      },
      (error: unknown) => setState({ kind: 'failed', message: (error as Error).message })
    );
  };
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon='IconArrowsRepeatRightLeft' title='Take over a task'>
        Someone handed you a task they started in Shinsa. Take it over to follow it, message its agent and
        answer what it asks, from this browser.
      </RemoteHero>
      <RemoteBenefits points={CLAIM_POINTS} />
      <div className='flex w-full flex-col items-center gap-2'>
        {state.kind === 'failed' && (
          <p role='alert' className='w-full text-destructive text-xs'>
            {state.message}
          </p>
        )}
        <Button className='w-full' loading={state.kind === 'claiming'} onClick={take}>
          Take over this task
        </Button>
        <p className='text-2xs text-fg-2'>{`As @${user.login}. The first account to open this link takes the task.`}</p>
      </div>
    </section>
  );
}
