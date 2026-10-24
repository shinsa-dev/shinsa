import type { ShinsaState, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import {
  DelegationQuestion,
  type DelegationStopper,
  DelegationSummary,
  StopDelegation,
} from '@/components/chat/delegation-card.tsx';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { type DelegationView, describeDelegations, listRoundDelegationTree } from '@/lib/chat/delegations.ts';
import { stopDelegation } from '@/lib/tasks/process.ts';

const DEPTH_INDENT = ['', '', 'ps-6.25'];

function DelegationRow({
  view,
  depth,
  onOpen,
  onStop,
}: {
  view: DelegationView;
  depth: number;
  onOpen: (runId: string) => void;
  onStop: DelegationStopper;
}) {
  return (
    <li className={cn('flex min-w-0 flex-col gap-1 py-2 first:pt-0 last:pb-0', DEPTH_INDENT[depth - 1])}>
      <div className='flex min-w-0 items-center gap-2 text-2xs'>
        {depth > 1 && (
          <IconSlot className='-me-0.75'>
            <Icon size='sm' name='IconArrowCornerDownRight' aria-hidden className='text-fg-2' />
          </IconSlot>
        )}
        <DelegationSummary
          view={view}
          title={
            <button
              type='button'
              onClick={() => onOpen(view.run.id)}
              className='flex min-w-0 flex-1 cursor-pointer text-left font-medium text-fg-4 text-xs transition-colors duration-150 hover:text-primary-text active:text-primary-text'
            >
              <Truncate>{view.title}</Truncate>
            </button>
          }
        />
        {view.live && <StopDelegation view={view} onStop={onStop} />}
      </div>
      {view.question && <DelegationQuestion question={view.question} />}
    </li>
  );
}

export function DelegationsPanel({
  state,
  task,
  onOpen,
  onStop = stopDelegation,
}: {
  state: ShinsaState;
  task: Task;
  onOpen: (runId: string) => void;
  onStop?: DelegationStopper;
}) {
  const tree = listRoundDelegationTree(state, task);
  if (tree.length === 0) return null;
  const summary = describeDelegations(tree.map((entry) => entry.view));
  return (
    <Panel
      title='Delegations'
      icon='IconAgents'
      action={summary && <span className='font-normal text-2xs text-fg-2 tabular-nums'>{summary}</span>}
    >
      <ul className='flex flex-col divide-y divide-border'>
        {tree.map(({ view, depth }) => (
          <DelegationRow key={view.run.id} view={view} depth={depth} onOpen={onOpen} onStop={onStop} />
        ))}
      </ul>
    </Panel>
  );
}
