import { cn } from '@shinsa/ui/lib/utils';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { describeResetsIn, type UsageRow } from '@/lib/accounts/usage.ts';
import { TONE_FILL } from '@/lib/format/tone.ts';

export function UsageBar({
  row,
  className,
}: {
  row: Pick<UsageRow, 'percent' | 'tone'>;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-percent={row.percent}
      className={cn('relative block h-1.5 overflow-hidden rounded-full bg-bg-a2', className)}
    >
      <span
        className={cn('absolute inset-y-0 start-0 rounded-full', TONE_FILL[row.tone])}
        style={{ width: `${row.percent}%` }}
      />
    </span>
  );
}

export function ResetTime({ at }: { at: number }) {
  return <TimeAgo at={at} text={(now) => describeResetsIn(at, now)} />;
}
