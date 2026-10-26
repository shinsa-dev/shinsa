import { Button } from '@shinsa/ui/components/button';
import type { IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { Hint } from '@/components/overlays/hint.tsx';
import { navigate, useRoute } from '@/router.ts';

type PageName = 'home' | 'tasks' | 'settings';

const PAGE_PATHS: Record<PageName, string> = { home: '/', tasks: '/tasks', settings: '/settings' };

export function NavButton({
  page,
  label,
  icon,
  activeIcon,
  iconOnly = false,
  shortcut,
  className,
  onNavigate,
}: {
  page: PageName;
  label: string;
  icon: IconName;
  activeIcon: IconName;
  iconOnly?: boolean;
  shortcut?: string;
  className?: string;
  onNavigate?: () => void;
}) {
  const active = useRoute().name === page;
  const button = (
    <Button
      variant='secondary'
      size={iconOnly ? 'icon-sm' : 'sm'}
      icon={active ? activeIcon : icon}
      aria-label={iconOnly ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(active ? 'text-fg-4' : 'text-fg-3', className)}
      onClick={() => {
        navigate(PAGE_PATHS[page]);
        onNavigate?.();
      }}
    >
      {iconOnly ? null : label}
    </Button>
  );
  if (!(iconOnly || shortcut)) return button;
  return (
    <Hint label={label} shortcut={shortcut}>
      {button}
    </Hint>
  );
}
