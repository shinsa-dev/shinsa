import { type Run, resolveSilenceLevel, type ShinsaState } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { INSET } from '@/components/layout/surface/card.ts';
import { QuietLink } from '@/components/overview/now-frame.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { useMinute } from '@/hooks/use-minute.ts';
import { useTranscript } from '@/lib/connection/socket.ts';
import { describeSilence, selectRunningTool } from '@/lib/overview/wait.ts';
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
  const running = selectRunningTool(useTranscript(run.id));
  const { busy, run: act } = useBusy<'snooze' | 'dismiss'>();
  const now = Date.now();
  const since = run.silence?.since ?? null;
  const level = resolveSilenceLevel(state, run, now);
  if (since === null || !describeSilence(level, since, now, running)) return null;
  return (
    <div className={cn(INSET, 'flex items-center gap-2 bg-bg-a1 px-3 py-2 text-2xs text-fg-2')}>
      <span
        className={cn(
          'flex shrink-0 items-center gap-2',
          level === 'critical' ? 'text-orange-text' : 'text-fg-3'
        )}
      >
        <Icon size='sm' name='IconClock' />
        <TimeAgo
          at={since}
          text={(at) => describeSilence(level, since, at, running) ?? ''}
          detail={running ? 'Started' : 'Last output'}
        />
      </span>
      <span className='flex min-w-0 flex-1'>
        {running?.command && (
          <Truncate className='font-mono text-fg-2'>{running.command.split('\n')[0]}</Truncate>
        )}
      </span>
      <QuietLink busy={busy !== null} onClick={() => void act('snooze', onSnooze)}>
        Snooze
      </QuietLink>
      <QuietLink busy={busy !== null} onClick={() => void act('dismiss', onDismiss)}>
        Dismiss
      </QuietLink>
    </div>
  );
}
