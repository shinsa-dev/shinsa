import type { Run } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { RoleMark } from '@/components/chat/role-mark.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { resolveLastAgentText } from '@/lib/chat/timeline.ts';
import { useTranscript } from '@/lib/connection/socket.ts';
import { flattenWhitespace } from '@/lib/format/count.ts';

export function MessageLink({
  run,
  fallback,
  onOpen,
  className,
}: {
  run: Run;
  fallback?: string | null;
  onOpen: (runId: string) => void;
  className?: string;
}) {
  const entries = useTranscript(run.id);
  const text = resolveLastAgentText(entries) ?? run.summary ?? fallback ?? null;
  return (
    <button
      type='button'
      onClick={() => onOpen(run.id)}
      className={cn(
        'corner-superellipse/1.125 group flex w-full min-w-0 cursor-pointer flex-col gap-px rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-bg-a1 active:bg-bg-a1',
        className
      )}
    >
      <span className='flex items-center gap-1.5 text-2xs text-fg-2'>
        <RoleMark role={run.role} className='font-medium text-fg-3' />
        <span>·</span>
        <TimeAgo at={run.endedAt ?? run.startedAt} />
        <span className='ms-auto flex items-center gap-1 text-fg-2 group-hover:text-fg-4 group-active:text-fg-4'>
          Open in chat
          <Icon size='sm' name='IconChevronRightSmall' />
        </span>
      </span>
      {text && (
        <span className='line-clamp-3 text-fg-4 text-xs'>
          <InlineMarkdown text={flattenWhitespace(text)} />
        </span>
      )}
    </button>
  );
}
