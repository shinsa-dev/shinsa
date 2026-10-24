import type { Run } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { ShimmeringText } from '@shinsa/ui/components/shimmering-text';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { SHIMMER_LINE } from '@/components/chat/chat-line.tsx';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import { Pulse } from '@/components/status/pulse.tsx';
import { describeParkedRun } from '@/lib/chat/delegations.ts';
import { useTranscript } from '@/lib/connection/socket.ts';
import { listFeedLines } from '@/lib/overview/now.ts';

const FEED_LINES = 4;

function LiveText({ text, paused }: { text: string; paused: boolean }) {
  if (paused) return <Truncate>{text}</Truncate>;
  return <ShimmeringText key={text} text={text} className={cn(SHIMMER_LINE, 'min-w-0')} />;
}

export function LiveFeed({ run }: { run: Run }) {
  const lines = listFeedLines(useTranscript(run.id), FEED_LINES);
  const paused = describeParkedRun(run) !== null;
  if (lines.length === 0) {
    return (
      <p className='text-2xs'>
        <LiveText text='Starting' paused={paused} />
      </p>
    );
  }
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
            {latest ? (
              <LiveText text={[line.label, line.text].filter(Boolean).join(' ')} paused={paused} />
            ) : (
              <>
                {line.label && <span className='shrink-0 font-medium'>{line.label}</span>}
                <Truncate>{line.text}</Truncate>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
