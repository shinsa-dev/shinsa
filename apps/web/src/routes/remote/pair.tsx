import type { PairView } from '@shinsa/core';
import { REMOTE_PATHS } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { SettingsCard } from '@/components/settings/group.tsx';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import { RemoteHero, RemoteLoading } from './shell.tsx';

type PairState =
  | { kind: 'loading' }
  | { kind: 'ready'; view: PairView }
  | { kind: 'approving'; view: PairView }
  | { kind: 'approved'; name: string }
  | { kind: 'failed'; message: string };

export function PairPage({
  claimCode,
  dashboard,
}: {
  claimCode: string | null;
  dashboard: Pick<DashboardClient, 'readPair' | 'approvePair'>;
}) {
  const [state, setState] = React.useState<PairState>(
    claimCode ? { kind: 'loading' } : { kind: 'failed', message: 'This link has no pairing code.' }
  );
  React.useEffect(() => {
    if (!claimCode) return;
    dashboard.readPair(claimCode).then(
      (read) =>
        setState(read.claimed ? { kind: 'approved', name: read.name } : { kind: 'ready', view: read }),
      (error: unknown) => setState({ kind: 'failed', message: (error as Error).message })
    );
  }, [claimCode, dashboard]);
  if (state.kind === 'loading') return <RemoteLoading label='Reading the pairing request' />;
  if (state.kind === 'failed')
    return (
      <section className='flex flex-col items-center gap-6 pt-4'>
        <RemoteHero icon='IconCircleX' tone='red' title='This machine cannot be paired'>
          {state.message}
        </RemoteHero>
      </section>
    );
  if (state.kind === 'approved')
    return (
      <section className='flex flex-col items-center gap-6 pt-4'>
        <RemoteHero icon='IconCheckCircle2' tone='blue' title={`${state.name} is paired`}>
          Your machine finishes setting up in a few seconds. To use it from this browser, add the browser on
          the machine: Settings, Remote access, Add browser.
        </RemoteHero>
        <Button className='w-full' nativeButton={false} render={<a href={REMOTE_PATHS.app} />}>
          Open Shinsa
        </Button>
      </section>
    );
  const { view } = state;
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon='IconServer' title={`Pair ${view.name} with your account`}>
        Approve only if you just turned on remote access on this machine yourself.
      </RemoteHero>
      <SettingsCard className='w-full'>
        <div className='flex flex-col items-center gap-1 px-3 py-4'>
          <span className='font-medium font-mono text-2xl text-fg-4 tracking-[0.2em]'>{view.claimCode}</span>
          <span className='text-center text-2xs text-fg-2'>
            Your machine shows this code in Settings, Remote access.
          </span>
        </div>
      </SettingsCard>
      <div className='flex w-full flex-col items-center gap-2'>
        <Button
          className='w-full'
          loading={state.kind === 'approving'}
          onClick={() => {
            setState({ kind: 'approving', view });
            dashboard.approvePair(view.claimCode).then(
              (approved) => setState({ kind: 'approved', name: approved.name }),
              (error: unknown) => setState({ kind: 'failed', message: (error as Error).message })
            );
          }}
        >
          Approve
        </Button>
        <p className='text-2xs text-fg-2'>
          Machine key: <span className='font-mono'>{view.fingerprint}</span>
        </p>
      </div>
    </section>
  );
}
