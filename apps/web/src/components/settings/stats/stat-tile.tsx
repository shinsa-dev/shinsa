import { cn } from '@shinsa/ui/lib/utils';
import { INSET } from '@/components/layout/surface/card.ts';
import type { ShippingTile } from '@/lib/stats/shipping.ts';

export const STAT_PANEL = cn(INSET, 'bg-bg-a1');

function StatTile({ tile }: { tile: ShippingTile }) {
  return (
    <div className='flex min-w-0 flex-col gap-1 bg-card px-3 py-2'>
      <span className='truncate text-2xs text-fg-2'>{tile.label}</span>
      <span className='flex min-w-0 items-baseline gap-1.5'>
        <span className='shrink-0 font-medium text-base text-fg-4 leading-6'>{tile.value}</span>
        {tile.detail && <span className='truncate text-2xs text-fg-2'>{tile.detail}</span>}
      </span>
    </div>
  );
}

export function StatTiles({ tiles }: { tiles: ShippingTile[] }) {
  return (
    <div className={cn(STAT_PANEL, 'grid grid-cols-2 gap-px overflow-hidden bg-border md:grid-cols-4')}>
      {tiles.map((tile) => (
        <StatTile key={tile.key} tile={tile} />
      ))}
    </div>
  );
}
