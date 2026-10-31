import { resolveMachineLoad, type Settings } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { acceptMachineRequest, declineMachineRequest } from '@/lib/connection/remote-access.ts';
import {
  type MachineAccess,
  type MachineChoice,
  useMachineAccess,
  useMachines,
} from '@/lib/connection/socket.ts';
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
import { PolicySettings } from './policies.tsx';
import { AccessRequestRows } from './remote-access.tsx';

const REQUESTS_DESCRIPTION =
  'Devices and people asking to reach your machines. Accepting adds the device, and for an invite gives that account full control of the machine.';

export function MachineAccessRequests({ machines }: { machines: MachineAccess[] }) {
  const waiting = machines.filter((machine) => (machine.remote?.requests.length ?? 0) > 0);
  if (waiting.length === 0) return null;
  return (
    <SettingsGroup title='Access requests' description={REQUESTS_DESCRIPTION}>
      {waiting.map((machine) => (
        <AccessRequestRows
          key={machine.id}
          title={`Waiting on ${machine.name}`}
          requests={machine.remote?.requests ?? []}
          access={machine.remote?.access ?? null}
          onAccept={(request) => acceptMachineRequest(machine.id, request.id)}
          onDecline={(request) => declineMachineRequest(machine.id, request.id)}
        />
      ))}
    </SettingsGroup>
  );
}

const MACHINES_DESCRIPTION =
  'Your machines and the ones shared with you. Those added on this device share this dashboard. Add a device from Settings, Remote access on its machine.';

function saveMachineSettings(machineId: string, patch: Partial<Settings>, done: string) {
  return sendCommandWithToast({ type: 'settings.change', patch }, done, machineId);
}

function MachineCapacity({ machine }: { machine: MachineChoice }) {
  const load = resolveMachineLoad(machine);
  return (
    <SelectField
      label={TASK_CAPACITY_TITLE}
      size='sm'
      items={listTaskCapacityItems(load.capacity)}
      value={resolveTaskCapacityValue(load.capacity)}
      onValueChange={(value) =>
        void saveMachineSettings(
          machine.id,
          { taskCapacity: parseTaskCapacity(value) },
          `${TASK_CAPACITY_TITLE} saved for ${machine.name}.`
        )
      }
    />
  );
}

function MachineList({
  rows,
  onRemove,
}: {
  rows: MachineRow[];
  onRemove: (row: MachineRow) => Promise<void>;
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
        <MachineItem
          key={row.instance.id}
          row={row}
          removing={removing === row.instance.id}
          onRemove={() => {
            setRemoving(row.instance.id);
            void onRemove(row).finally(() => setRemoving(null));
          }}
        />
      ))}
    </>
  );
}

function MachineItem({
  row,
  removing,
  onRemove,
}: {
  row: MachineRow;
  removing: boolean;
  onRemove: () => void;
}) {
  const machine = useMachines().find((candidate) => candidate.id === row.instance.id);
  const detail = machine ? `${row.access} · ${describeMachineLoad(resolveMachineLoad(machine))}` : row.access;
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex min-w-0 items-center gap-1.5 text-xs'>
          <Truncate className='text-fg-4'>{row.label}</Truncate>
          <span className={cn('shrink-0', row.instance.online ? TONE_TEXT.green : 'text-fg-2')}>
            {row.status}
          </span>
        </div>
        <Truncate className='text-2xs text-fg-2'>{detail}</Truncate>
      </div>
      <div className='flex shrink-0 items-center gap-1.5'>
        {machine && <MachineCapacity machine={machine} />}
        <Button variant='secondary' size='sm' loading={removing} onClick={onRemove}>
          {row.instance.role === 'member' ? 'Leave' : 'Remove'}
        </Button>
      </div>
    </div>
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
  const remove = async (row: MachineRow) => {
    if (!services) return;
    const id = row.instance.id;
    await (row.instance.role === 'member'
      ? services.dashboard.leaveInstance(id)
      : services.dashboard.removeInstance(id));
    await services.devices.removeDevice(id);
    setVersion((value) => value + 1);
  };
  return { rows, failure, remove };
}

export function MachinesSettings() {
  const { rows, failure, remove } = useMachineRows();
  const machines = useMachines();
  const access = useMachineAccess();
  return (
    <>
      <MachineAccessRequests machines={access} />
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
      <PolicySettings
        machines={machines}
        unreachable={(rows ?? [])
          .filter((row) => !row.device)
          .map((row) => ({ id: row.instance.id, name: row.instance.name }))}
      />
    </>
  );
}
