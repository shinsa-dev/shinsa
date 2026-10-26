import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import { BrandLink } from '@/components/layout/brand-link.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { HOME_SHORTCUT, isDesktop } from '@/lib/desktop.ts';
import { navigate, useRoute } from '@/router.ts';

function HomeButton({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const active = useRoute().name === 'home';
  return (
    <Hint label='Home' shortcut={HOME_SHORTCUT}>
      <Button
        variant='secondary'
        size='sm'
        icon={active ? 'IconHomeRoundDoorFilled' : 'IconHomeRoundDoor'}
        aria-current={active ? 'page' : undefined}
        className={cn(active && 'text-fg-4', className)}
        onClick={() => {
          navigate('/');
          onNavigate?.();
        }}
      >
        Home
      </Button>
    </Hint>
  );
}

export function HomeLink({
  onNavigate,
  className,
  brandClassName,
}: {
  onNavigate?: () => void;
  className?: string;
  brandClassName?: string;
}) {
  if (isDesktop()) return <HomeButton onNavigate={onNavigate} className={className} />;
  return <BrandLink onNavigate={onNavigate} className={cn(className, brandClassName)} />;
}
