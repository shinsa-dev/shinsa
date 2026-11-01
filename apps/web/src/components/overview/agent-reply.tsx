import type { AgentReply, ReplyOutcome } from '@shinsa/core';
import { ChecklistMark } from '@shinsa/ui/components/checklist';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { REPLY_OUTCOME } from '@/lib/overview/exchanges.ts';

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

export function AgentReplyBlock({ reply, headline = true }: { reply: AgentReply; headline?: boolean }) {
  return (
    <div className='flex flex-col gap-3'>
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
          <span className='font-medium text-fg-4 text-xs leading-5'>What to do now</span>
          <Markdown text={reply.next} className='text-fg-3 text-xs' />
        </div>
      )}
    </div>
  );
}
