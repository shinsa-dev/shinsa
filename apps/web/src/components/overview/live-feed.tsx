import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import { Pulse } from '@/components/status/pulse.tsx';
import { useTranscript } from '@/lib/connection/socket.ts';
import { listFeedLines } from '@/lib/overview/now.ts';

const FEED_LINES = 4;

export function LiveFeed({ runId }: { runId: string }) {
  const lines = listFeedLines(useTranscript(runId), FEED_LINES);
  if (lines.length === 0) return <p className='text-2xs text-fg-2'>Starting</p>;
  return (
    <ol className='flex flex-col'>
      {lines.map((line, index) => {
        const latest = index === lines.length - 1;
        return (
          <li
            key={line.key}
            className={cn(
              'flex h-6 min-w-0 items-center gap-1.25 text-2xs',
              latest ? 'text-fg-4' : 'text-fg-2'
            )}
          >
            <IconSlot>{latest ? <Pulse tone='blue' /> : <Icon size='sm' name={line.icon} />}</IconSlot>
            {line.label && <span className='shrink-0 font-medium'>{line.label}</span>}
            <Truncate>{line.text}</Truncate>
          </li>
        );
      })}
    </ol>
  );
}
