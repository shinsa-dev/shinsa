import { cn } from '@shinsa/ui/lib/utils';
import { INSET } from '@/components/layout/surface/card.ts';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import type { ShippingTile } from '@/lib/stats/shipping.ts';

export const STAT_PANEL = cn(INSET, 'bg-bg-a1');

const TILE_EDGE = 'border-border md:not-first:border-l max-md:even:border-l max-md:nth-[n+3]:border-t';

function StatTile({ tile }: { tile: ShippingTile }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 px-3 py-2', TILE_EDGE)}>
      <span className='truncate text-2xs text-fg-2'>{tile.label}</span>
      <span className='flex min-w-0 items-baseline gap-1.5'>
        <span className='shrink-0 font-medium text-base text-fg-4 leading-6'>{tile.value}</span>
        {tile.detail && <span className='truncate text-2xs text-fg-2'>{tile.detail}</span>}
        {tile.changes && <DiffStats added={tile.changes.added} removed={tile.changes.removed} />}
      </span>
    </div>
  );
}

export function StatTiles({ tiles }: { tiles: ShippingTile[] }) {
  return (
    <div className={cn(STAT_PANEL, 'grid grid-cols-2 overflow-hidden md:grid-cols-4')}>
      {tiles.map((tile) => (
        <StatTile key={tile.key} tile={tile} />
      ))}
    </div>
  );
}
