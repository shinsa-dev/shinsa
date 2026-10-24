import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { Hint } from '@/components/overlays/hint.tsx';
import { formatLines } from '@/lib/format/count.ts';

export function DiffStatsLabel({ added, removed }: { added: number; removed: number }) {
  return (
    <span className='whitespace-nowrap'>
      <span className='text-green-text'>{formatLines(added)}</span> <TooltipLabel>added</TooltipLabel>
      {' · '}
      <span className='text-red-text'>{formatLines(removed)}</span> <TooltipLabel>removed</TooltipLabel>
    </span>
  );
}

export function DiffStats({ added, removed }: { added: number; removed: number }) {
  return (
    <Hint label={<DiffStatsLabel added={added} removed={removed} />}>
      <span className='flex w-fit shrink-0 items-center gap-1.5 font-normal text-2xs tabular-nums'>
        <span className='text-green-text'>+{added}</span>
        <span className='text-red-text'>−{removed}</span>
      </span>
    </Hint>
  );
}
