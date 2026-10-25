import { Button } from '@shinsa/ui/components/button';
import { BrandLink } from '@/components/layout/brand-link.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { HOME_SHORTCUT, isDesktop } from '@/lib/desktop.ts';
import { navigate } from '@/router.ts';

function HomeButton({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  return (
    <Hint label='Home' shortcut={HOME_SHORTCUT}>
      <Button
        variant='secondary'
        size='icon-sm'
        icon='IconHome'
        aria-label='Home'
        className={className}
        onClick={() => {
          navigate('/');
          onNavigate?.();
        }}
      />
    </Hint>
  );
}

export function HomeLink({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  if (isDesktop()) return <HomeButton onNavigate={onNavigate} className={className} />;
  return <BrandLink onNavigate={onNavigate} className={className} />;
}
