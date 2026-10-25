import { Spinner } from '@shinsa/ui/components/spinner';
import { useDelayed } from '@/hooks/use-delayed.ts';

export function CodeLoading({ label }: { label: string }) {
  const shown = useDelayed(true);
  return (
    <div
      data-loading-state={shown ? label : undefined}
      data-loading-pending={shown ? undefined : label}
      className='flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center font-sans text-fg-2 text-xs'
    >
      {shown && (
        <>
          <Spinner size='sm' />
          <span>{label}</span>
        </>
      )}
    </div>
  );
}
