import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { RowChevron } from '@/components/chat/tool-group.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { CheckOutcomeIcon } from '@/components/status/check-mark.tsx';
import { Pulse } from '@/components/status/pulse.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { Duration } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { useNow } from '@/hooks/use-now.ts';
import {
  DELEGATION_OUTCOME,
  type DelegationView,
  describeReportVerb,
  describeStopDelegation,
  resolveDelegationStatusLabel,
  selectDelegation,
} from '@/lib/chat/delegations.ts';
import type { TimelineItemOf } from '@/lib/chat/timeline.ts';
import { useConnection } from '@/lib/connection/socket.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { stopDelegation } from '@/lib/tasks/process.ts';

export const OpenDelegations = React.createContext<ReadonlySet<string>>(new Set());

function DelegationMark({ view }: { view: DelegationView }) {
  const status = resolveDelegationStatusLabel(view);
  if (view.status === 'queued' || view.status === 'running' || view.status === 'waiting') {
    return <Pulse tone={status.tone} />;
  }
  return (
    <CheckOutcomeIcon outcome={DELEGATION_OUTCOME[view.status]} label={status.label} className='size-3.5' />
  );
}

function DelegationStatus({ view }: { view: DelegationView }) {
  const now = useNow();
  const status = resolveDelegationStatusLabel(view);
  const end = view.run.endedAt ?? Math.max(now, view.run.startedAt);
  return (
    <span className={cn('shrink-0 tabular-nums', TONE_TEXT[status.tone])}>
      {status.label}
      <span className='text-fg-2'>
        {' · '}
        <Duration from={view.run.startedAt} to={end} ongoing={view.live} />
      </span>
    </span>
  );
}

export function DelegationSummary({ view, title }: { view: DelegationView; title: React.ReactNode }) {
  return (
    <>
      <span className='grid size-3.5 shrink-0 place-items-center'>
        <DelegationMark view={view} />
      </span>
      <span className='shrink-0 text-fg-2'>{view.role}</span>
      {title}
      <DelegationStatus view={view} />
    </>
  );
}

export function DelegationQuestion({ question, className }: { question: string; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-start gap-2 text-xs', className)}>
      <Icon name='IconBubbleQuestion' aria-hidden className='mt-0.5 size-3.5 shrink-0 text-amber-text' />
      <InlineMarkdown text={question} className='min-w-0 text-fg-3' />
    </div>
  );
}

export type DelegationStopper = (runId: string) => Promise<boolean>;

export function StopDelegation({ view, onStop }: { view: DelegationView; onStop: DelegationStopper }) {
  const { busy, run } = useBusy<'stop'>();
  const label = describeStopDelegation(view);
  return (
    <Hint label={label}>
      <Button
        variant='secondary'
        size='icon-xs'
        icon='IconCrossSmall'
        aria-label={label}
        loading={busy === 'stop'}
        onClick={(event) => {
          event.stopPropagation();
          void run('stop', () => onStop(view.run.id));
        }}
      />
    </Hint>
  );
}

type ConversationRenderer = (view: DelegationView) => React.ReactNode;

export function DelegationSpawnCard({
  view,
  conversation,
  onStop,
}: {
  view: DelegationView;
  conversation: ConversationRenderer;
  onStop: DelegationStopper;
}) {
  const opened = React.useContext(OpenDelegations).has(view.run.id);
  const [open, setOpen] = React.useState(opened);
  React.useEffect(() => {
    if (opened) setOpen(true);
  }, [opened]);
  return (
    <div
      data-message
      data-delegation={view.run.id}
      className={cn(
        CARD,
        'flex min-w-0 scroll-mt-4 flex-col overflow-hidden transition-colors duration-500 data-focused:bg-primary-a1'
      )}
    >
      <div className='flex h-9 min-w-0 items-center gap-1 ps-3 pe-1.5'>
        <button
          type='button'
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className='group/row flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-2xs'
        >
          <DelegationSummary
            view={view}
            title={<Truncate className='min-w-0 flex-1 font-medium text-fg-4 text-xs'>{view.title}</Truncate>}
          />
          <RowChevron open={open} className='group-hover/row:text-fg-4 group-active/row:text-fg-4' />
        </button>
        {view.live && <StopDelegation view={view} onStop={onStop} />}
      </div>
      {view.question && (
        <DelegationQuestion question={view.question} className='border-border border-t px-3 py-2' />
      )}
      {open && <div className='border-border border-t py-1'>{conversation(view)}</div>}
    </div>
  );
}

export function DelegationReportRow({ view }: { view: DelegationView }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div data-message className='flex min-w-0 flex-col'>
      <button
        type='button'
        aria-expanded={open}
        disabled={!view.result}
        onClick={() => setOpen(!open)}
        className='group/row flex h-5 min-w-0 cursor-pointer items-center gap-1.5 self-start text-2xs text-fg-2 transition-colors duration-150 hover:text-fg-4 active:text-fg-4 disabled:cursor-default'
      >
        <DelegationMark view={view} />
        <span className='truncate'>
          {describeReportVerb(view)}: <span className='text-fg-3'>{view.title}</span>
        </span>
        {view.result && <RowChevron open={open} className='text-current' />}
      </button>
      {open && view.result && (
        <div className='ms-1.5 mt-2 mb-1 border-border border-l ps-4'>
          <Markdown text={view.result} className='prose-chat' />
        </div>
      )}
    </div>
  );
}

export function DelegationNotice({
  item,
  conversation,
}: {
  item: TimelineItemOf<'delegation'>;
  conversation: ConversationRenderer;
}) {
  const { state } = useConnection();
  const views = item.runIds.flatMap((runId) => {
    const view = state ? selectDelegation(state, runId) : null;
    return view ? [view] : [];
  });
  if (views.length === 0) return null;
  return (
    <div className='flex min-w-0 flex-col gap-2'>
      {views.map((view) =>
        item.event === 'started' ? (
          <DelegationSpawnCard
            key={view.run.id}
            view={view}
            conversation={conversation}
            onStop={stopDelegation}
          />
        ) : (
          <DelegationReportRow key={view.run.id} view={view} />
        )
      )}
    </div>
  );
}
