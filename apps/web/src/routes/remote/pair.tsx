import type { PairView } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { SettingRow, SettingsCard } from '@/components/settings/group.tsx';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import { MACHINES_PATH } from '@/lib/remote/mode.ts';
import { RemoteLoading } from './shell.tsx';

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
      <section className='flex flex-col gap-4'>
        <PageHeading title='This Mac cannot be paired' description={state.message} />
      </section>
    );
  if (state.kind === 'approved')
    return (
      <section className='flex flex-col gap-4'>
        <PageHeading
          title={`${state.name} is paired`}
          description='Your Mac finishes setting up its tunnel in a few seconds. To use it from this browser, add the browser on the Mac: Settings, Remote access, Add device.'
        />
        <div className='flex'>
          <Button nativeButton={false} variant='outline' render={<a href={MACHINES_PATH} />}>
            Show your machines
          </Button>
        </div>
      </section>
    );
  const { view } = state;
  return (
    <section className='flex flex-col gap-4'>
      <PageHeading
        title={`Pair ${view.name} with your account`}
        description='Only approve this if you just turned remote access on yourself. Check that the fingerprint matches the one your Mac shows in Settings.'
      />
      <SettingsCard>
        <SettingRow title='Machine'>
          <span className='text-fg-3 text-xs'>{view.name}</span>
        </SettingRow>
        <SettingRow title='Fingerprint'>
          <span className='font-mono text-fg-3 text-xs'>{view.fingerprint}</span>
        </SettingRow>
        <SettingRow title='Code'>
          <span className='font-mono text-fg-3 text-xs'>{view.claimCode}</span>
        </SettingRow>
      </SettingsCard>
      <div>
        <Button
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
      </div>
    </section>
  );
}
