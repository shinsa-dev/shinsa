import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';

export function FilePath({ path, className }: { path: string; className?: string }) {
  const slash = path.lastIndexOf('/');
  return (
    <Truncate className={cn('text-2xs', className)}>
      {slash >= 0 && <span className='text-fg-2'>{path.slice(0, slash + 1)}</span>}
      <span className='text-fg-4'>{path.slice(slash + 1)}</span>
    </Truncate>
  );
}
