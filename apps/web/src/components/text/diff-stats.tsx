import { formatNumber } from '@/lib/format/count.ts';

export function DiffStats({
  added,
  removed,
  muted = false,
}: {
  added: number;
  removed: number;
  muted?: boolean;
}) {
  return (
    <span className='flex w-fit shrink-0 items-center gap-1.5 text-2xs font-normal tabular-nums'>
      <span className={muted ? 'text-fg-1' : 'text-green-text'}>+{formatNumber(added)}</span>
      <span className={muted ? 'text-fg-1' : 'text-red-text'}>−{formatNumber(removed)}</span>
    </span>
  );
}
