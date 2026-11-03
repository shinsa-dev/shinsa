import { formatNumber } from '@/lib/format/count.ts';
import { formatCompactCount } from '@/lib/format/money.ts';

export function DiffStats({
  added,
  removed,
  muted = false,
  compact = false,
}: {
  added: number;
  removed: number;
  muted?: boolean;
  compact?: boolean;
}) {
  const format = compact ? formatCompactCount : formatNumber;
  return (
    <span className='flex w-fit shrink-0 items-center gap-1.5 text-2xs font-normal tabular-nums'>
      <span className={muted ? 'text-fg-1' : 'text-green-text'}>+{format(added)}</span>
      <span className={muted ? 'text-fg-1' : 'text-red-text'}>−{format(removed)}</span>
    </span>
  );
}
