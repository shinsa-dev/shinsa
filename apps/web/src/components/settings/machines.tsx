import { type MachineResources, type RemoteInstance, resolveMachineLoad, type Settings } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { UsageBar } from '@/components/accounts/usage-bar.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { ListRow } from '@/components/layout/list-row.tsx';
import { SectionChevron } from '@/components/layout/page/section-label.tsx';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { acceptMachineRequest, declineMachineRequest } from '@/lib/connection/remote-access.ts';
import { useShinsaSelector } from '@/lib/connection/selectors.ts';
import {
  type MachineAccess,
  type MachineChoice,
  useMachineAccess,
  useMachines,
  useUnreachableMachines,
} from '@/lib/connection/socket.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { describeMachineLoad } from '@/lib/new-task.ts';
import { createDisclosureId, useDisclosure } from '@/lib/preferences/disclosure.ts';
import {
  listMachineRows,
  listTaskCapacityItems,
  type MachineRow,
  parseTaskCapacity,
  resolveTaskCapacityValue,
  TASK_CAPACITY_TITLE,
} from '@/lib/remote/machines.ts';
import { describeOutdatedMachine, MACHINES_SECTION } from '@/lib/remote/mode.ts';
import {
  describeMachineResources,
  listResourceGauges,
  listTaskResourceRows,
  NO_RESOURCE_READING,
} from '@/lib/remote/resources.ts';
import { RemoteServicesContext } from '@/lib/remote/services.ts';
import { navigate, resolveTaskPath } from '@/router.ts';
import { SETTING_ROW, SettingsEmpty, SettingsGroup } from './group.tsx';
import { PolicySettings } from './policies.tsx';
import { AccessRequestRows } from './remote-access.tsx';

function resolveViewerId(instances: RemoteInstance[], machineId: string) {
  const instance = instances.find((entry) => entry.id === machineId);
  return instance?.role === 'owner' ? instance.owner.id : null;
}

const REQUESTS_DESCRIPTION =
  'Devices and people asking to reach your machines. Accepting adds the device, and gives anyone new full control of the machine.';

export function MachineAccessRequests({
  machines,
  instances,
}: {
  machines: MachineAccess[];
  instances: RemoteInstance[];
}) {
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
          viewerId={resolveViewerId(instances, machine.id)}
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

function ResourceGauges({ resources }: { resources: MachineResources }) {
  return (
    <div
      role='img'
      aria-label={describeMachineResources(resources)}
      className='flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-fg-2 tabular-nums'
    >
      {listResourceGauges(resources).map((gauge) => (
        <span key={gauge.id} className='flex items-center gap-1.5'>
          <span>{gauge.label}</span>
          {gauge.percent !== null && (
            <UsageBar row={{ percent: gauge.percent, tone: gauge.tone }} className='w-12' />
          )}
          <span className='text-fg-3'>{gauge.value}</span>
        </span>
      ))}
    </div>
  );
}

function MachineTasks({ resources }: { resources: MachineResources }) {
  const tasks = useShinsaSelector((state) => state.tasks) ?? {};
  const rows = listTaskResourceRows(resources, tasks);
  if (rows.length === 0)
    return <p className='py-1.5 pl-7 text-2xs text-fg-2'>No open task is using this machine.</p>;
  return (
    <div className='flex flex-col gap-px pb-1 pl-5'>
      {rows.map((entry) => (
        <ListRow
          key={entry.task.id}
          title={entry.task.title}
          meta={entry.use}
          trailing={entry.worktree}
          onClick={() => navigate(resolveTaskPath(entry.task))}
        />
      ))}
    </div>
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
  const outdated = useUnreachableMachines().some(
    (candidate) => candidate.id === row.instance.id && candidate.outdated
  );
  const { open, toggle } = useDisclosure(createDisclosureId('settings', 'machines', row.instance.id), false);
  const detail = machine ? `${row.access} · ${describeMachineLoad(resolveMachineLoad(machine))}` : row.access;
  const resources = !outdated && machine ? (machine.resources ?? null) : null;
  const name = (
    <>
      <Truncate className='font-medium text-fg-4'>{row.label}</Truncate>
      <span className={cn('shrink-0', row.instance.online ? TONE_TEXT.green : 'text-fg-2')}>
        {row.status}
      </span>
    </>
  );
  return (
    <div className='flex flex-col'>
      <div className={cn(SETTING_ROW, 'items-start py-2')}>
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          {resources ? (
            <button
              type='button'
              aria-expanded={open}
              aria-label={`${open ? 'Hide' : 'Show'} the open tasks on ${row.instance.name}`}
              onClick={toggle}
              className='flex min-w-0 cursor-pointer items-center gap-1.5 text-left text-xs hover:text-fg-4 active:text-fg-4'
            >
              <SectionChevron open={open} className='shrink-0' />
              {name}
            </button>
          ) : (
            <div className='flex min-w-0 items-center gap-1.5 text-xs'>{name}</div>
          )}
          <Truncate className={cn('text-2xs', outdated ? TONE_TEXT.amber : 'text-fg-2')}>
            {outdated ? describeOutdatedMachine(row.instance.name) : detail}
          </Truncate>
          {resources ? (
            <ResourceGauges resources={resources} />
          ) : (
            machine && !outdated && <p className='text-2xs text-fg-2'>{NO_RESOURCE_READING}</p>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-1.5'>
          {machine && <MachineCapacity machine={machine} />}
          <Button variant='secondary' size='sm' loading={removing} onClick={onRemove}>
            {row.instance.role === 'member' ? 'Leave' : 'Remove'}
          </Button>
        </div>
      </div>
      {open && resources && <MachineTasks resources={resources} />}
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
      <MachineAccessRequests machines={access} instances={(rows ?? []).map((row) => row.instance)} />
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
          .filter((row) => !row.device || row.device.waiting)
          .map((row) => ({ id: row.instance.id, name: row.instance.name }))}
      />
    </>
  );
}
