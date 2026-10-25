import { Spinner } from '@shinsa/ui/components/spinner';

export function CodeLoading({ label }: { label: string }) {
  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center font-sans text-fg-2 text-xs'>
      <Spinner size='sm' />
      <span>{label}</span>
    </div>
  );
}
