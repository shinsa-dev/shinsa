import type { Round, RoundShipping, Task } from '@shinsa/core';
import * as React from 'react';
import { RoundHeader } from '@/components/chat/round-header.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { listEarlierRounds, listWaitingRounds } from '@/lib/tasks/rounds.ts';

type ShippingChanger = (round: Round, shipping: RoundShipping) => Promise<unknown>;

function RoundDetail({ round }: { round: Round }) {
  const outcome = round.outcome;
  return (
    <div className='flex flex-col gap-2 px-3 pb-2 text-xs'>
      <div className='flex flex-col gap-px'>
        <span className='text-2xs text-fg-2'>Asked for</span>
        <Markdown text={round.request} className='text-fg-3' />
      </div>
      {outcome?.goal && (
        <div className='flex flex-col gap-px'>
          <span className='text-2xs text-fg-2'>Goal</span>
          <Markdown text={outcome.goal} className='text-fg-3' />
        </div>
      )}
      {outcome?.headline && (
        <div className='flex flex-col gap-px'>
          <span className='text-2xs text-fg-2'>What it did</span>
          <Markdown text={outcome.headline} className='text-fg-3' />
        </div>
      )}
      {outcome?.result && (
        <div className='flex flex-col gap-px'>
          <span className='text-2xs text-fg-2'>What it found</span>
          <Markdown text={outcome.result} className='text-fg-3' />
        </div>
      )}
    </div>
  );
}

function RoundRow({
  task,
  round,
  onShippingChange,
}: {
  task: Task;
  round: Round;
  onShippingChange?: ShippingChanger;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <li className='flex flex-col'>
      <RoundHeader
        task={task}
        round={round}
        open={open}
        onToggle={() => setOpen(!open)}
        {...(onShippingChange ? { onShippingChange } : {})}
      />
      {open && <RoundDetail round={round} />}
    </li>
  );
}

export function RoundsPanel({ task, onShippingChange }: { task: Task; onShippingChange?: ShippingChanger }) {
  const earlier = listEarlierRounds(task);
  const waiting = listWaitingRounds(task);
  if (earlier.length + waiting.length === 0) return null;
  return (
    <Panel title='Rounds' icon='IconLayersThree'>
      {earlier.length > 0 && (
        <ul aria-label='Earlier rounds' className='-mx-3 -mt-1 flex flex-col divide-y divide-border'>
          {earlier.map((round) => (
            <RoundRow key={round.number} task={task} round={round} />
          ))}
        </ul>
      )}
      {waiting.length > 0 && (
        <ul aria-label='Rounds waiting to start' className='-mx-3 -mb-1 flex flex-col divide-y divide-border'>
          {waiting.map((round) => (
            <RoundRow
              key={round.number}
              task={task}
              round={round}
              {...(onShippingChange ? { onShippingChange } : {})}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
