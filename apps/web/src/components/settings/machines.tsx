import { resolveMachineLoad, type Settings } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { type MachineChoice, useMachines } from '@/lib/connection/socket.ts';
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

const MACHINES_DESCRIPTION =
  'Every machine you turned remote access on for. The ones added on this device share this one dashboard, and each task runs on one machine. A new task goes to the machine of the project you pick, else where your policies send it, else to the one with the most room under its task capacity. To add a device, choose Add device in Settings, Remote access on that machine.';

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
        <MachineItem
          key={row.instance.id}
          row={row}
          removing={removing === row.instance.id}
          onRemove={() => {
            setRemoving(row.instance.id);
            void onRemove(row.instance.id).finally(() => setRemoving(null));
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
          Remove
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
  const machines = useMachines();
  return (
    <>
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
      <PolicySettings machines={machines} />
    </>
  );
}
