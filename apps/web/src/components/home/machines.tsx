import type { ShinsaState } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import * as React from 'react';
import { ListRow } from '@/components/layout/list-row.tsx';
import { WideSection } from '@/components/queue/queue.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { type MachineChoice, useMachines } from '@/lib/connection/socket.ts';
import { resolveHomeSectionId } from '@/lib/home.ts';
import { MACHINE_ICON } from '@/lib/remote/mode.ts';
import { listMachineResourceRows, type MachineResourceRow } from '@/lib/remote/resources.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

function MachineResourceItem({ row }: { row: MachineResourceRow }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <ListRow
        leading={<StatusTile icon={MACHINE_ICON} tone='neutral' />}
        title={row.name}
        meta={row.use}
        trailing={
          <span className='flex items-center gap-1'>
            {row.load}
            <Icon name={open ? 'IconChevronTopMedium' : 'IconChevronDownMedium'} size='sm' />
          </span>
        }
        expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open &&
        (row.tasks.length === 0 ? (
          <p className='py-1.5 pr-2.5 pl-10 text-2xs text-fg-2'>No open task is using this machine.</p>
        ) : (
          <div className='flex flex-col gap-px pl-8'>
            {row.tasks.map((entry) => (
              <ListRow
                key={entry.task.id}
                title={entry.task.title}
                meta={entry.use}
                trailing={entry.worktree}
                onClick={() => navigate(resolveTaskPath(entry.task))}
              />
            ))}
          </div>
        ))}
    </>
  );
}

export function MachinesSection({ state, machines }: { state: ShinsaState; machines: MachineChoice[] }) {
  if (machines.length === 0) return null;
  const rows = listMachineResourceRows(machines, state.tasks);
  return (
    <WideSection
      title='Machines'
      count={rows.length}
      empty={null}
      persistId={resolveHomeSectionId('machines')}
    >
      {rows.map((row) => (
        <MachineResourceItem key={row.id} row={row} />
      ))}
    </WideSection>
  );
}

export function HomeMachines({ state }: { state: ShinsaState }) {
  return <MachinesSection state={state} machines={useMachines()} />;
}
