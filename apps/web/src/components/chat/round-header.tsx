import type { PullRequest, Round, RoundPullRequest, RoundShipping, Task } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { SelectField } from '@/components/controls/select-field.tsx';
import { SectionChevron } from '@/components/layout/page/section-label.tsx';
import { GlyphLabel, INLINE_TILE, SMART_LINK } from '@/components/links/link.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { ProgressTrack } from '@/components/overview/progress-track.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  changeRoundShipping,
  describeRoundStatus,
  listShippingItems,
  resolveRoundTrack,
  selectRoundPullRequest,
} from '@/lib/tasks/rounds.ts';

type ShippingChanger = (round: Round, shipping: RoundShipping) => Promise<unknown>;

const PULL_REQUEST_STATE = { open: 'Open', merged: 'Merged', closed: 'Closed' } as const;

function RoundPullRequestLink({ pullRequest }: { pullRequest: RoundPullRequest | PullRequest }) {
  return (
    <Hint label={`Pull request #${pullRequest.number}`} detail={PULL_REQUEST_STATE[pullRequest.state]}>
      <a
        data-smart
        href={pullRequest.url}
        target='_blank'
        rel='noreferrer'
        className={cn(SMART_LINK, 'text-xs')}
      >
        <GlyphLabel
          glyph={
            <StatusTile
              icon={pullRequest.state === 'merged' ? 'IconMerged' : 'IconPullRequest'}
              tone={pullRequest.state === 'merged' ? 'purple' : 'green'}
              size='sm'
              className={INLINE_TILE}
            />
          }
          text={`#${pullRequest.number}`}
          className='tabular-nums'
        />
      </a>
    </Hint>
  );
}

function RoundShippingSelect({
  task,
  round,
  onChange = (changed, shipping) => changeRoundShipping(task, changed, shipping),
}: {
  task: Task;
  round: Round;
  onChange?: ShippingChanger;
}) {
  const items = listShippingItems(task, round);
  if (!items) return null;
  return (
    <SelectField
      label={`How round ${round.number} ships`}
      size='sm'
      variant='ghost'
      items={items}
      value={round.shipping}
      onValueChange={(shipping) => void onChange(round, shipping)}
    />
  );
}

export function RoundHeader({
  task,
  round,
  open,
  onToggle,
  onShippingChange,
  className,
}: {
  task: Task;
  round: Round;
  open: boolean;
  onToggle: () => void;
  onShippingChange?: ShippingChanger;
  className?: string;
}) {
  const status = describeRoundStatus(round);
  const pullRequest = selectRoundPullRequest(task, round);
  return (
    <div className={cn('flex flex-col gap-2 px-3 py-2', className)}>
      <div className='flex min-w-0 items-center gap-2'>
        <button
          type='button'
          aria-expanded={open}
          onClick={onToggle}
          className='flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-start text-xs outline-none transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
        >
          <span className='shrink-0 font-medium text-fg-4'>Round {round.number}</span>
          <Truncate className='min-w-0 text-fg-3'>{round.title}</Truncate>
          <span className={cn('shrink-0 text-2xs', TONE_TEXT[status.tone])}>{status.label}</span>
          <SectionChevron open={open} className='shrink-0 text-fg-2' />
        </button>
        {pullRequest && <RoundPullRequestLink pullRequest={pullRequest} />}
        <RoundShippingSelect
          task={task}
          round={round}
          {...(onShippingChange ? { onChange: onShippingChange } : {})}
        />
      </div>
      {open && <ProgressTrack progress={resolveRoundTrack(task, round)} />}
    </div>
  );
}
