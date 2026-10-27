import { type Run, resolveSilenceLevel, type ShinsaState } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { INSET } from '@/components/layout/surface/card.ts';
import { QuietLink } from '@/components/overview/now-frame.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { useMinute } from '@/hooks/use-minute.ts';
import { describeSilence } from '@/lib/overview/wait.ts';
import { dismissSilence, snoozeSilence } from '@/lib/tasks/process.ts';

export function SilenceNote({
  state,
  run,
  onSnooze = () => snoozeSilence(run.id),
  onDismiss = () => dismissSilence(run.id),
}: {
  state: ShinsaState;
  run: Run;
  onSnooze?: () => Promise<boolean>;
  onDismiss?: () => Promise<boolean>;
}) {
  useMinute();
  const { busy, run: act } = useBusy<'snooze' | 'dismiss'>();
  const now = Date.now();
  const since = run.silence?.since ?? null;
  const level = resolveSilenceLevel(state, run, now);
  if (since === null || !describeSilence(level, since, now)) return null;
  return (
    <div className={cn(INSET, 'flex items-center gap-2 bg-bg-a1 px-3 py-2 text-2xs text-fg-2')}>
      <span
        className={cn('flex items-center gap-2', level === 'critical' ? 'text-orange-text' : 'text-fg-3')}
      >
        <Icon size='sm' name='IconClock' />
        <TimeAgo at={since} text={(at) => describeSilence(level, since, at) ?? ''} detail='Last output' />
      </span>
      <span className='flex-1' />
      <QuietLink busy={busy !== null} onClick={() => void act('snooze', onSnooze)}>
        Snooze
      </QuietLink>
      <QuietLink busy={busy !== null} onClick={() => void act('dismiss', onDismiss)}>
        Dismiss
      </QuietLink>
    </div>
  );
}
