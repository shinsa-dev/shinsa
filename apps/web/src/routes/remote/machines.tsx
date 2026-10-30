import type { RemoteInstance } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import * as React from 'react';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { SETTING_ROW, SettingsCard } from '@/components/settings/group.tsx';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { DeviceStore } from '@/lib/remote/devices.ts';
import { describeMachine, type MachineRow } from '@/lib/remote/machines.ts';
import { writeChosenInstance } from '@/lib/remote/mode.ts';
import { RemoteLoading } from './shell.tsx';

function useMachines(
  dashboard: Pick<DashboardClient, 'listInstances'>,
  devices: Pick<DeviceStore, 'selectDevice'>
) {
  const [rows, setRows] = React.useState<MachineRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const instances = await dashboard.listInstances();
        const enrolled = await Promise.all(
          instances.map(
            async (instance: RemoteInstance) => (await devices.selectDevice(instance.id)) !== null
          )
        );
        if (live)
          setRows(instances.map((instance, index) => describeMachine(instance, enrolled[index] ?? false)));
      } catch (caught) {
        if (live) setError((caught as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [dashboard, devices, version]);
  return { rows, error, reload: () => setVersion((value) => value + 1) };
}

function MachineList({
  rows,
  onRemove,
}: {
  rows: MachineRow[];
  onRemove: (instanceId: string) => Promise<void>;
}) {
  const [removing, setRemoving] = React.useState<string | null>(null);
  return (
    <SettingsCard className='divide-y divide-border'>
      {rows.map((row) => (
        <div key={row.instance.id} className={`${SETTING_ROW} py-2`}>
          <div className='flex min-w-0 flex-1 flex-col gap-px'>
            <span className='truncate text-fg-4 text-xs'>{row.instance.name}</span>
            <span className='truncate text-2xs text-fg-2'>
              {row.status} · {row.access}
            </span>
          </div>
          <Button
            variant='secondary'
            size='sm'
            loading={removing === row.instance.id}
            onClick={() => {
              setRemoving(row.instance.id);
              void onRemove(row.instance.id).finally(() => setRemoving(null));
            }}
          >
            Remove
          </Button>
          <Button
            size='sm'
            disabled={!row.canOpen}
            onClick={() => {
              writeChosenInstance(sessionStorage, row.instance.id);
              location.assign('/');
            }}
          >
            Open
          </Button>
        </div>
      ))}
    </SettingsCard>
  );
}

export function MachinesPage({
  dashboard,
  devices,
}: {
  dashboard: Pick<DashboardClient, 'listInstances' | 'removeInstance'>;
  devices: Pick<DeviceStore, 'selectDevice' | 'removeDevice'>;
}) {
  const { rows, error, reload } = useMachines(dashboard, devices);
  if (error)
    return (
      <p role='alert' className='text-destructive text-xs'>
        {error}
      </p>
    );
  if (!rows) return <RemoteLoading label='Reading your machines' />;
  const heading = (
    <PageHeading
      title='Your machines'
      description='The Macs you turned remote access on for. To use one here, add this browser on that Mac first: Settings, Remote access, Add device.'
    />
  );
  if (rows.length === 0)
    return (
      <section className='flex flex-col gap-4'>
        {heading}
        <EmptyState
          icon='IconServer'
          title='No machines yet'
          description='On your Mac, open Shinsa, go to Settings, Remote access and turn it on.'
        />
      </section>
    );
  return (
    <section className='flex flex-col gap-4'>
      {heading}
      <MachineList
        rows={rows}
        onRemove={async (instanceId) => {
          await dashboard.removeInstance(instanceId);
          await devices.removeDevice(instanceId);
          reload();
        }}
      />
    </section>
  );
}
