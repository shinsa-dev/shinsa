import type { Run } from '@shinsa/core';
import { ShimmeringText } from '@shinsa/ui/components/shimmering-text';
import { SizeAnimator } from '@shinsa/ui/components/size-animator';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { RowChevron, SHIMMER_LINE } from '@/components/chat/chat-line.tsx';
import { TurnDetail } from '@/components/chat/turn-detail.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import { Pulse } from '@/components/status/pulse.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { Duration } from '@/components/text/time-ago.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { describeParkedRun } from '@/lib/chat/delegations.ts';
import type { RunTurn } from '@/lib/chat/timeline.ts';
import { resolveLiveStep, selectLatestAgentText } from '@/lib/chat/turns.ts';
import { flattenWhitespace, formatSteps } from '@/lib/format/count.ts';

const SWAP_MS = 240;

interface Shown {
  key: string;
  text: string;
  entering: boolean;
}

function SwapText({ id, text }: { id: string; text: string }) {
  const [shown, setShown] = React.useState<Shown>({ key: id, text, entering: false });
  const [leaving, setLeaving] = React.useState<Shown | null>(null);
  if (shown.key !== id) {
    setLeaving(shown);
    setShown({ key: id, text, entering: true });
  } else if (shown.text !== text) {
    setShown({ ...shown, text });
  }
  return (
    <SizeAnimator duration={SWAP_MS}>
      <div className='relative'>
        {leaving && (
          <p
            key={leaving.key}
            aria-hidden
            onAnimationEnd={() => setLeaving(null)}
            className='chat-swap-out pointer-events-none absolute inset-x-0 top-0 line-clamp-4 text-xs'
          >
            <InlineMarkdown text={flattenWhitespace(leaving.text)} className='prose-chat' />
          </p>
        )}
        <p
          key={shown.key}
          aria-live='polite'
          className={cn('line-clamp-4 text-xs', shown.entering && 'chat-swap-in')}
        >
          <InlineMarkdown text={flattenWhitespace(shown.text)} className='prose-chat' />
        </p>
      </div>
    </SizeAnimator>
  );
}

export function LiveCard({ run, turn, waiting }: { run: Run; turn: RunTurn; waiting: boolean }) {
  const [open, setOpen] = React.useState(false);
  const now = useNow();
  const latest = selectLatestAgentText(turn);
  const parked = describeParkedRun(run);
  const step = parked?.label ?? resolveLiveStep(turn, waiting);
  const paused = waiting || parked !== null;
  const tone = parked?.tone ?? (waiting ? 'amber' : 'blue');
  return (
    <div data-message className={cn(CARD, 'flex min-w-0 flex-col overflow-hidden')}>
      {latest && (
        <div className='px-3 pt-3'>
          <SwapText id={latest.key} text={latest.text} />
        </div>
      )}
      <button
        type='button'
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className='group/row flex h-9 min-w-0 cursor-pointer items-center gap-1.25 px-3 text-left text-2xs'
      >
        <IconSlot>
          <Pulse tone={tone} />
        </IconSlot>
        <span className='min-w-0 flex-1 truncate text-fg-3 leading-normal'>
          {paused ? step : <ShimmeringText key={step} text={step} className={SHIMMER_LINE} />}
        </span>
        <span className='shrink-0 text-fg-2 tabular-nums transition-colors duration-150 group-hover/row:text-fg-4 group-active/row:text-fg-4'>
          <Duration from={turn.startedAt} to={Math.max(now, turn.startedAt)} ongoing />
          {turn.steps > 0 && ` · ${formatSteps(turn.steps)}`}
        </span>
        <RowChevron
          open={open}
          className='-me-1 text-fg-2 group-hover/row:text-fg-4 group-active/row:text-fg-4'
        />
      </button>
      {open && (
        <div className='border-border border-t p-3'>
          <TurnDetail items={turn.work.filter((item) => item !== latest)} run={run} />
        </div>
      )}
    </div>
  );
}
