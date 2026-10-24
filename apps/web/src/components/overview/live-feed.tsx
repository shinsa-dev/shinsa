import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { Pulse } from '@/components/status/pulse.tsx';
import { useTranscript } from '@/lib/connection/socket.ts';
import { listFeedLines } from '@/lib/overview/now.ts';

const FEED_LINES = 4;

export function LiveFeed({ runId }: { runId: string }) {
  const lines = listFeedLines(useTranscript(runId), FEED_LINES);
  if (lines.length === 0) return <p className='text-2xs text-fg-2'>Starting up…</p>;
  return (
    <ol className='flex flex-col'>
      {lines.map((line, index) => {
        const latest = index === lines.length - 1;
        return (
          <li
            key={line.key}
            className={cn('flex h-6 min-w-0 items-center gap-2 text-2xs', latest ? 'text-fg-4' : 'text-fg-2')}
          >
            <span className='grid size-4 shrink-0 place-items-center'>
              {latest ? <Pulse tone='blue' /> : <Icon name={line.icon} className='size-3' />}
            </span>
            {line.label && <span className='shrink-0 font-medium'>{line.label}</span>}
            <Truncate>{line.text}</Truncate>
          </li>
        );
      })}
    </ol>
  );
}
