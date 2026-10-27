import type { Round, RoundShipping, Run, ShinsaState, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import * as React from 'react';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { RoundHeader } from '@/components/overview/round-header.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { listTaskRuns } from '@/lib/chat/runs.ts';
import {
  resolveOverviewPanelId,
  resolveTaskDisclosureId,
  useDisclosure,
} from '@/lib/preferences/disclosure.ts';
import {
  listEarlierRounds,
  listWaitingRounds,
  ROUND_ICON,
  resolveRoundSummary,
  selectRoundRun,
} from '@/lib/tasks/rounds.ts';

type ShippingChanger = (round: Round, shipping: RoundShipping) => Promise<unknown>;

function RoundDetail({
  round,
  run,
  onOpen,
}: {
  round: Round;
  run: Run | null;
  onOpen: (runId: string) => void;
}) {
  return (
    <div className='flex flex-col gap-1.5 ps-7 pt-1.5'>
      <InlineMarkdown text={resolveRoundSummary(round)} className='text-fg-3 text-xs' />
      {run && (
        <button
          type='button'
          onClick={() => onOpen(run.id)}
          className='flex cursor-pointer items-center gap-1 self-start text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4'
        >
          Open in chat
          <Icon size='sm' name='IconChevronRightSmall' />
        </button>
      )}
    </div>
  );
}

function RoundRow({
  task,
  round,
  run,
  onOpen,
  onShippingChange,
}: {
  task: Task;
  round: Round;
  run: Run | null;
  onOpen: (runId: string) => void;
  onShippingChange?: ShippingChanger;
}) {
  const disclosure = useDisclosure(
    resolveTaskDisclosureId(task.id, 'overview', 'round', String(round.number)),
    false
  );
  return (
    <li className='flex flex-col py-2 first:pt-0 last:pb-0'>
      <RoundHeader
        task={task}
        round={round}
        disclosure={disclosure}
        {...(onShippingChange ? { onShippingChange } : {})}
      />
      {disclosure.open && <RoundDetail round={round} run={run} onOpen={onOpen} />}
    </li>
  );
}

export function RoundsPanel({
  state,
  task,
  onOpen,
  onShippingChange,
}: {
  state: ShinsaState;
  task: Task;
  onOpen: (runId: string) => void;
  onShippingChange?: ShippingChanger;
}) {
  const runs = React.useMemo(() => listTaskRuns(state.runs, task.id), [state.runs, task.id]);
  const earlier = listEarlierRounds(task);
  const waiting = listWaitingRounds(task);
  if (earlier.length + waiting.length === 0) return null;
  const row = (round: Round, changer?: ShippingChanger) => (
    <RoundRow
      key={round.number}
      task={task}
      round={round}
      run={selectRoundRun(runs, round)}
      onOpen={onOpen}
      {...(changer ? { onShippingChange: changer } : {})}
    />
  );
  return (
    <Panel persistId={resolveOverviewPanelId(task, 'rounds')} title='Rounds' icon={ROUND_ICON}>
      <div className='flex flex-col divide-y divide-border'>
        {earlier.length > 0 && (
          <ul
            aria-label='Earlier rounds'
            className='flex flex-col divide-y divide-border py-2 first:pt-0 last:pb-0'
          >
            {earlier.map((round) => row(round))}
          </ul>
        )}
        {waiting.length > 0 && (
          <ul
            aria-label='Rounds waiting to start'
            className='flex flex-col divide-y divide-border py-2 first:pt-0 last:pb-0'
          >
            {waiting.map((round) => row(round, onShippingChange))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
