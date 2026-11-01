import type { AgentReply, Iteration, ReplyOutcome, Task } from '@shinsa/core';
import { ChecklistMark } from '@shinsa/ui/components/checklist';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { DisclosureChevron, DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import {
  type AnsweredIteration,
  describeOutcomes,
  describeRequestText,
  type Exchange,
  listEarlierExchanges,
  REPLY_OUTCOME,
} from '@/lib/overview/exchanges.ts';
import {
  resolveOverviewPanelId,
  resolveTaskDisclosureId,
  useDisclosure,
} from '@/lib/preferences/disclosure.ts';

function Caption({ children }: { children: React.ReactNode }) {
  return <span className='font-medium text-fg-4 text-xs leading-5'>{children}</span>;
}

function PointGlyph({ outcome }: { outcome: ReplyOutcome }) {
  if (outcome === 'done') return <ChecklistMark done label='Done' />;
  const glyph = REPLY_OUTCOME[outcome];
  return <Icon size='sm' name={glyph.icon} aria-label={glyph.label} className={glyph.className} />;
}

function PointList({ reply }: { reply: AgentReply }) {
  return (
    <ul className='flex flex-col gap-2'>
      {reply.points.map((point) => (
        <li key={point.ask} className='flex gap-2.5'>
          <span className='flex h-5 shrink-0 items-center'>
            <PointGlyph outcome={point.outcome} />
          </span>
          <div className='flex min-w-0 flex-col gap-px'>
            <span className='flex flex-wrap items-baseline gap-x-2'>
              <InlineMarkdown text={point.ask} className='font-medium text-fg-4 text-xs leading-5' />
              {point.outcome !== 'done' && (
                <span className={cn('text-2xs', REPLY_OUTCOME[point.outcome].className)}>
                  {REPLY_OUTCOME[point.outcome].label}
                </span>
              )}
            </span>
            <InlineMarkdown text={point.note} className='selectable text-fg-3 text-xs' />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SentQuote({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('prose-shinsa selectable min-w-0 text-xs', className)}>
      <blockquote className='whitespace-pre-wrap'>{text}</blockquote>
    </div>
  );
}

function SentFold({ task, iteration }: { task: Task; iteration: Iteration }) {
  const disclosure = useDisclosure(
    resolveTaskDisclosureId(task.id, 'overview', 'reply', iteration.id, 'sent'),
    false
  );
  const sent = describeRequestText(iteration);
  if (!sent) return null;
  return (
    <div className='flex flex-col gap-1.5'>
      <DisclosureHeader disclosure={disclosure} label='what you sent' className='gap-1.5 text-fg-2 text-xs'>
        <span className='group-hover/disclosure:text-fg-4 group-active/disclosure:text-fg-4'>
          What you sent
        </span>
        <DisclosureChevron />
      </DisclosureHeader>
      {disclosure.open && <SentQuote text={sent} />}
    </div>
  );
}

export function ReplyReport({
  task,
  iteration,
  headline = true,
}: {
  task: Task;
  iteration: AnsweredIteration;
  headline?: boolean;
}) {
  const reply = iteration.reply;
  return (
    <div className='flex flex-col gap-3'>
      <SentFold task={task} iteration={iteration} />
      <div className='flex flex-col gap-2'>
        {headline && (
          <InlineMarkdown
            text={reply.headline}
            className='selectable font-medium text-fg-4 text-xs leading-5'
          />
        )}
        <PointList reply={reply} />
      </div>
      {reply.next && (
        <div className='flex flex-col gap-1'>
          <Caption>What to do now</Caption>
          <Markdown text={reply.next} className='text-fg-3 text-xs' />
        </div>
      )}
    </div>
  );
}

export function WorkingRequest({ iteration }: { iteration: Iteration }) {
  const text = describeRequestText(iteration);
  if (!text) return null;
  return (
    <div className='flex flex-col gap-1'>
      <span className='text-fg-2 text-xs'>Your request</span>
      <SentQuote text={text} className='line-clamp-4' />
    </div>
  );
}

function ExchangeRow({ task, exchange }: { task: Task; exchange: Exchange }) {
  const disclosure = useDisclosure(
    resolveTaskDisclosureId(task.id, 'overview', 'exchange', exchange.key),
    false
  );
  const request = exchange.kind === 'request';
  const title = request
    ? exchange.iteration.reply.headline
    : (exchange.summary ?? `Plan version ${exchange.version}`);
  return (
    <li className='flex flex-col gap-2 py-2 first:pt-0 last:pb-0'>
      <DisclosureHeader
        disclosure={disclosure}
        label={request ? 'the reply' : 'the plan change'}
        className='gap-2 text-xs'
      >
        <Icon size='sm' name={request ? 'IconChecklist' : 'IconNote1'} className='shrink-0 text-fg-3' />
        {disclosure.open ? (
          <InlineMarkdown text={title} className='min-w-0 flex-1 font-medium text-fg-4' />
        ) : (
          <Truncate className='min-w-0 flex-1 text-fg-3 group-hover/disclosure:text-fg-4 group-active/disclosure:text-fg-4'>
            {title}
          </Truncate>
        )}
        <span className='shrink-0 text-2xs text-fg-2 tabular-nums'>
          {request ? `${describeOutcomes(exchange.iteration.reply)} · ` : `Plan v${exchange.version} · `}
          <TimeAgo at={exchange.at} />
        </span>
        <DisclosureChevron className='text-fg-3' />
      </DisclosureHeader>
      {disclosure.open && (
        <div className='ps-6'>
          {request ? (
            <ReplyReport task={task} iteration={exchange.iteration} headline={false} />
          ) : (
            <div className='flex flex-col gap-1'>
              <span className='text-fg-2 text-xs'>What you sent</span>
              <SentQuote text={exchange.feedback} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function RequestsPanel({ task, shownId }: { task: Task; shownId: string | null }) {
  const exchanges = listEarlierExchanges(task, shownId);
  if (exchanges.length === 0) return null;
  return (
    <Panel
      persistId={resolveOverviewPanelId(task, 'requests')}
      title={shownId ? 'Earlier requests' : 'Your requests'}
      icon='IconChecklist'
      count={exchanges.length}
    >
      <ul className='flex flex-col divide-y divide-border'>
        {exchanges.map((exchange) => (
          <ExchangeRow key={exchange.key} task={task} exchange={exchange} />
        ))}
      </ul>
    </Panel>
  );
}
