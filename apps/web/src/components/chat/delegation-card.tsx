import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CARD_LINE, ChatLine, ExpandRow, SELECTED_WASH } from '@/components/chat/chat-line.tsx';
import { RoleMark } from '@/components/chat/role-mark.tsx';
import { CARD, CHAT_INSET, CHAT_NESTED } from '@/components/layout/surface/card.ts';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
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
import { useDisclosure, useDisclosureScope } from '@/lib/preferences/disclosure.ts';
import { stopDelegation } from '@/lib/tasks/process.ts';

export const OpenDelegations = React.createContext<ReadonlySet<string>>(new Set());

function DelegationMark({ view }: { view: DelegationView }) {
  const status = resolveDelegationStatusLabel(view);
  if (view.status === 'queued' || view.status === 'running' || view.status === 'waiting') {
    return <Pulse tone={status.tone} />;
  }
  return <CheckOutcomeIcon outcome={DELEGATION_OUTCOME[view.status]} label={status.label} />;
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
      <IconSlot className='-me-0.75'>
        <DelegationMark view={view} />
      </IconSlot>
      <RoleMark role={view.run.role} className='text-fg-2' />
      {title}
      <DelegationStatus view={view} />
    </>
  );
}

export function DelegationQuestion({ question, className }: { question: string; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-start gap-1.25 text-xs leading-5', className)}>
      <IconSlot>
        <Icon size='sm' name='IconBubbleQuestion' aria-hidden className='text-amber-text' />
      </IconSlot>
      <InlineMarkdown text={question} className='selectable min-w-0 text-fg-3' />
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
  const disclosure = useDisclosure(useDisclosureScope('delegation', view.run.id), opened);
  const { replaceOpen } = disclosure;
  React.useEffect(() => {
    if (opened) replaceOpen(true);
  }, [opened, replaceOpen]);
  return (
    <div
      data-message
      data-delegation={view.run.id}
      className={cn(CARD, 'flex min-w-0 scroll-mt-4 flex-col overflow-hidden', SELECTED_WASH)}
    >
      <DisclosureHeader
        disclosure={disclosure}
        label='delegation'
        strip='band'
        chevron='box'
        action={view.live && <StopDelegation view={view} onStop={onStop} />}
        className={cn(CARD_LINE, 'gap-2')}
      >
        <DelegationSummary
          view={view}
          title={<Truncate className='min-w-0 flex-1 font-medium text-fg-4'>{view.title}</Truncate>}
        />
      </DisclosureHeader>
      {view.question && (
        <DelegationQuestion question={view.question} className='border-border border-t px-3 py-2' />
      )}
      {disclosure.open && (
        <div className={cn('border-border border-t py-1', CHAT_NESTED)}>{conversation(view)}</div>
      )}
    </div>
  );
}

export function DelegationReportRow({ view }: { view: DelegationView }) {
  const parts = { icon: <DelegationMark view={view} />, label: `${describeReportVerb(view)}: ${view.title}` };
  const persistId = useDisclosureScope('delegation', view.run.id, 'report');
  return (
    <div data-message className={cn('flex min-w-0 flex-col', CHAT_INSET)}>
      {view.result ? (
        <ExpandRow persistId={persistId} {...parts}>
          <Markdown text={view.result} className='prose-chat' />
        </ExpandRow>
      ) : (
        <ChatLine {...parts} />
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
