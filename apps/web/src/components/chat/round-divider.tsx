import type { Round } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { CHAT_INSET } from '@/components/layout/surface/card.ts';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { useMinute } from '@/hooks/use-minute.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { ROUND_ICON, resolveRoundDivider } from '@/lib/tasks/rounds.ts';

export function RoundDivider({ round, first }: { round: Round; first: boolean }) {
  useMinute();
  const divider = resolveRoundDivider(round);
  return (
    <h2 className={cn('flex h-5 min-w-0 items-center gap-2', CHAT_INSET, first ? 'mt-2 mb-2' : 'mt-7 mb-2')}>
      <Hint label={divider.heading} detail={divider.time}>
        <span
          data-chat-line
          className='inline-flex h-5 min-w-0 max-w-full cursor-default items-center gap-1.25 text-fg-2 text-xs'
        >
          <IconSlot>
            <Icon size='sm' name={ROUND_ICON} className='text-fg-3' />
          </IconSlot>
          <span className='flex min-w-0 whitespace-pre'>
            <span className='truncate'>
              <span className='font-medium text-fg-3 tabular-nums'>{divider.label}</span> · {divider.title}
            </span>
            <span className='shrink-0'>
              {' · '}
              <span className={TONE_TEXT[divider.status.tone]}>{divider.status.label}</span>
            </span>
          </span>
        </span>
      </Hint>
      <span aria-hidden className='h-px min-w-6 flex-1 bg-border' />
    </h2>
  );
}
