import { type Iteration, lowerFirst, type Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { DisclosureChevron, DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { AgentReplyBlock } from '@/components/overview/agent-reply.tsx';
import { MentionText } from '@/components/people/user-tag.tsx';
import { useReadOnlyOwner, useReadOnlyOwnerName } from '@/components/task/read-only.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import {
  type AnsweredIteration,
  describeOutcomes,
  describeRequestLabel,
  describeRequestText,
  describeSentLabel,
  listEarlierReplies,
} from '@/lib/overview/exchanges.ts';
import {
  resolveOverviewPanelId,
  resolveTaskDisclosureId,
  useDisclosure,
} from '@/lib/preferences/disclosure.ts';
import { describeMentionText } from '@/lib/remote/users.ts';

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
  const label = describeSentLabel(useReadOnlyOwnerName());
  if (!sent) return null;
  return (
    <div className='flex flex-col gap-1.5'>
      <DisclosureHeader
        disclosure={disclosure}
        label={lowerFirst(label)}
        className='gap-1.5 text-fg-2 text-xs'
      >
        <span className='group-hover/disclosure:text-fg-4 group-active/disclosure:text-fg-4'>{label}</span>
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
  return (
    <div className='flex flex-col gap-3'>
      <SentFold task={task} iteration={iteration} />
      <AgentReplyBlock reply={iteration.reply} headline={headline} />
    </div>
  );
}

export function WorkingRequest({ iteration }: { iteration: Iteration }) {
  const text = describeRequestText(iteration);
  const label = describeRequestLabel(useReadOnlyOwner());
  if (!text) return null;
  return (
    <div className='flex flex-col gap-1'>
      <span className='text-fg-2 text-xs'>
        <MentionText mention={label} />
      </span>
      <SentQuote text={text} className='line-clamp-4' />
    </div>
  );
}

function ExchangeRow({ task, iteration }: { task: Task; iteration: AnsweredIteration }) {
  const disclosure = useDisclosure(
    resolveTaskDisclosureId(task.id, 'overview', 'exchange', iteration.id),
    false
  );
  const title = iteration.reply.headline;
  return (
    <li className='flex flex-col gap-2 py-2 first:pt-0 last:pb-0'>
      <DisclosureHeader disclosure={disclosure} label='the reply' className='gap-2 text-xs'>
        <Icon size='sm' name='IconChecklist' className='shrink-0 text-fg-3' />
        {disclosure.open ? (
          <InlineMarkdown text={title} className='min-w-0 flex-1 font-medium text-fg-4' />
        ) : (
          <Truncate className='min-w-0 flex-1 text-fg-3 group-hover/disclosure:text-fg-4 group-active/disclosure:text-fg-4'>
            {title}
          </Truncate>
        )}
        <span className='shrink-0 text-2xs text-fg-2 tabular-nums'>
          {`${describeOutcomes(iteration.reply)} · `}
          <TimeAgo at={iteration.repliedAt} />
        </span>
        <DisclosureChevron className='text-fg-3' />
      </DisclosureHeader>
      {disclosure.open && (
        <div className='ps-6'>
          <ReplyReport task={task} iteration={iteration} headline={false} />
        </div>
      )}
    </li>
  );
}

export function RequestsPanel({ task, shownId }: { task: Task; shownId: string | null }) {
  const replies = listEarlierReplies(task, shownId);
  const owner = useReadOnlyOwner();
  if (replies.length === 0) return null;
  return (
    <Panel
      persistId={resolveOverviewPanelId(task, 'requests')}
      title={shownId ? 'Earlier requests' : `${describeMentionText(describeRequestLabel(owner))}s`}
      icon='IconChecklist'
      count={replies.length}
    >
      <ul className='flex flex-col divide-y divide-border'>
        {replies.map((iteration) => (
          <ExchangeRow key={iteration.id} task={task} iteration={iteration} />
        ))}
      </ul>
    </Panel>
  );
}
