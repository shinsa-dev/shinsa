import { resolveMachineLoad } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { useMachines } from '@/lib/connection/socket.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { describeMachineLoad } from '@/lib/new-task.ts';
import {
  listMachineRows,
  listTaskCapacityItems,
  type MachineRow,
  parseTaskCapacity,
  resolveTaskCapacityValue,
  TASK_CAPACITY_TITLE,
} from '@/lib/remote/machines.ts';
import { MACHINES_SECTION } from '@/lib/remote/mode.ts';
import { RemoteServicesContext } from '@/lib/remote/services.ts';
import { SETTING_ROW, SettingsEmpty, SettingsGroup } from './group.tsx';

const MACHINES_DESCRIPTION =
  'Every machine you turned remote access on for. The ones added in this browser share this one dashboard; each task runs on one machine and shows it. A new task goes to the machine of its project, or else to the one with the most room under its task capacity. To add a browser, choose Add browser in Settings, Remote access on that machine.';

function MachineCapacity({ machineId }: { machineId: string }) {
  const machine = useMachines().find((candidate) => candidate.id === machineId);
  if (!machine) return null;
  const load = resolveMachineLoad(machine);
  return (
    <>
      <span className='shrink-0 text-fg-2 text-xs'>{describeMachineLoad(load)}</span>
      <SelectField
        label={TASK_CAPACITY_TITLE}
        size='sm'
        items={listTaskCapacityItems(load.capacity)}
        value={resolveTaskCapacityValue(load.capacity)}
        onValueChange={(value) =>
          void sendCommandWithToast(
            { type: 'settings.change', patch: { taskCapacity: parseTaskCapacity(value) } },
            `${TASK_CAPACITY_TITLE} saved for ${machine.name}.`,
            machineId
          )
        }
      />
    </>
  );
}

function MachineList({
  rows,
  onRemove,
}: {
  rows: MachineRow[];
  onRemove: (instanceId: string) => Promise<void>;
}) {
  const [removing, setRemoving] = React.useState<string | null>(null);
  if (rows.length === 0)
    return (
      <SettingsEmpty>
        No machine yet. Turn on remote access in Settings on the machine that runs Shinsa.
      </SettingsEmpty>
    );
  return (
    <>
      {rows.map((row) => (
        <div key={row.instance.id} className={SETTING_ROW}>
          <div className='flex min-w-0 flex-1 items-center gap-2.5'>
            <StatusTile
              icon='IconServer'
              tone={row.instance.online ? 'green' : 'neutral'}
              label={row.instance.online ? 'Online' : 'Offline'}
            />
            <div className='flex min-w-0 flex-1 flex-col gap-px'>
              <Truncate className='text-fg-4 text-xs'>{row.instance.name}</Truncate>
              <Truncate className='text-2xs text-fg-2'>{row.access}</Truncate>
            </div>
          </div>
          <span className={cn('shrink-0 text-xs', row.instance.online ? TONE_TEXT.green : 'text-fg-2')}>
            {row.status}
          </span>
          <MachineCapacity machineId={row.instance.id} />
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
    </>
  );
}

function useMachineRows() {
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
        <SettingsEmpty>Reading your machines.</SettingsEmpty>
      )}
    </SettingsGroup>
  );
}
