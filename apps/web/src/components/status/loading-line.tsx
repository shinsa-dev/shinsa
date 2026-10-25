import { Spinner } from '@shinsa/ui/components/spinner';
import { cn } from '@shinsa/ui/lib/utils';
import { useDelayed } from '@/hooks/use-delayed.ts';

export function LoadingLine({ label, className }: { label: string; className?: string }) {
  const shown = useDelayed(true);
  return (
    <span
      data-loading-state={shown ? label : undefined}
      data-loading-pending={shown ? undefined : label}
      aria-hidden={!shown}
      className={cn('flex items-center gap-2 text-fg-2', !shown && 'invisible', className)}
    >
      <Spinner size='sm' />
      {label}
    </span>
  );
}

export function LoadingSpinner({ label, className }: { label: string; className?: string }) {
  const shown = useDelayed(true);
  if (!shown) return <span data-loading-pending={label} />;
  return (
    <span data-loading-state={label} className={cn('inline-flex text-fg-2', className)}>
      <Spinner size='lg' aria-label={label} />
    </span>
  );
}
