import { Logo } from '@shinsa/ui/components/logo';
import { cn } from '@shinsa/ui/lib/utils';
import { navigate } from '@/router.ts';

export function BrandLink({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  return (
    <button
      type='button'
      onClick={() => {
        navigate('/');
        onNavigate?.();
      }}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 font-medium text-fg-4 text-sm outline-none',
        className
      )}
    >
      <span className='grid size-5 shrink-0 place-items-center'>
        <Logo className='size-3.25' />
      </span>
      Shinsa
    </button>
  );
}
