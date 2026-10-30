import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { TONE_FILL, TONE_TEXT } from '@/lib/format/tone.ts';
import { listMachineRows, type MachineRow } from '@/lib/remote/machines.ts';
import { MACHINES_SECTION } from '@/lib/remote/mode.ts';
import { RemoteServicesContext } from '@/lib/remote/services.ts';
import { SETTING_ROW, SettingsEmpty, SettingsGroup } from './group.tsx';

const MACHINES_DESCRIPTION =
  'Every Mac you turned remote access on for. The ones added in this browser share this one dashboard; each task shows its Mac. To add a browser, choose Add device in Settings, Remote access on that Mac.';

export function MachineList({
  rows,
  onRemove,
}: {
  rows: MachineRow[];
  onRemove: (instanceId: string) => Promise<void>;
}) {
  const [removing, setRemoving] = React.useState<string | null>(null);
  if (rows.length === 0)
    return <SettingsEmpty>No Mac yet. Turn on remote access in Settings on your Mac.</SettingsEmpty>;
  return (
    <div className='flex flex-col divide-y divide-border'>
      {rows.map((row) => (
        <div key={row.instance.id} className={`${SETTING_ROW} gap-3 py-2.5`}>
          <span className='corner-superellipse/1.125 grid size-8 shrink-0 place-items-center rounded-control-sm bg-bg-a2 text-fg-3'>
            <Icon name='IconMacbook' size='md' />
          </span>
          <div className='flex min-w-0 flex-1 flex-col gap-px'>
            <span className='truncate font-medium text-fg-4 text-xs'>{row.instance.name}</span>
            <span className='flex min-w-0 items-center gap-1.5 text-2xs text-fg-2'>
              <span
                aria-hidden
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  TONE_FILL[row.instance.online ? 'green' : 'neutral']
                )}
              />
              <span className={cn('shrink-0', row.instance.online && TONE_TEXT.green)}>{row.status}</span>
              <span aria-hidden>·</span>
              <span className='truncate'>{row.access}</span>
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
        </div>
      ))}
    </div>
  );
}

export function useMachineRows() {
  const services = React.useContext(RemoteServicesContext);
  const [rows, setRows] = React.useState<MachineRow[] | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    if (!services) return;
    let live = true;
    listMachineRows(services.dashboard, services.devices).then(
      (next) => {
        if (live) setRows(next);
      },
      (error: unknown) => {
        if (live) setFailure((error as Error).message);
      }
    );
    return () => {
      live = false;
    };
  }, [services, version]);
  const remove = async (instanceId: string) => {
    if (!services) return;
    await services.dashboard.removeInstance(instanceId);
    await services.devices.removeDevice(instanceId);
    setVersion((value) => value + 1);
  };
  return { rows, failure, remove };
}

export function MachinesSettings() {
  const { rows, failure, remove } = useMachineRows();
  return (
    <SettingsGroup title={MACHINES_SECTION} description={MACHINES_DESCRIPTION}>
      {failure && (
        <p role='alert' className='px-2 py-1.5 text-destructive text-xs'>
          {failure}
        </p>
      )}
      {rows ? (
        <MachineList rows={rows} onRemove={remove} />
      ) : (
        <SettingsEmpty>Reading your Macs.</SettingsEmpty>
      )}
    </SettingsGroup>
  );
}
