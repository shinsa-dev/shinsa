import { cn } from '@shinsa/ui/lib/utils';
import { INSET } from '@/components/layout/surface/card.ts';

export function StatTile({ label, value, detail }: { label: string; value: string; detail: string | null }) {
  return (
    <div className={cn(INSET, 'flex min-w-0 flex-col gap-1 bg-bg-a1 px-3 py-2.5')}>
      <span className='truncate text-2xs text-fg-2'>{label}</span>
      <span className='truncate font-semibold text-2xl text-fg-4'>{value}</span>
      <span className='truncate text-2xs text-fg-2'>{detail ?? ' '}</span>
    </div>
  );
}

export function StatTiles({ children }: { children: React.ReactNode }) {
  return <div className='grid grid-cols-2 gap-1.5 md:grid-cols-4'>{children}</div>;
}
