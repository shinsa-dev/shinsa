import { Logo } from '@shinsa/ui/components/logo';
import * as React from 'react';
import { BrandLink } from '@/components/layout/brand-link.tsx';
import { NavButton } from '@/components/layout/nav-button.tsx';
import { DesktopChrome, HOME_SHORTCUT, isDesktop } from '@/lib/desktop.ts';

export type HomeLinkVariant = 'bar' | 'icon' | 'brand';

export function HomeLink({
  variant = 'bar',
  onNavigate,
}: {
  variant?: HomeLinkVariant;
  onNavigate?: () => void;
}) {
  const chrome = React.useContext(DesktopChrome);
  const desktop = chrome || isDesktop();
  if (variant === 'brand' && !desktop) return <BrandLink onNavigate={onNavigate} />;
  const home = (
    <NavButton
      page='home'
      label='Home'
      icon='IconHomeRoundDoor'
      activeIcon='IconHomeRoundDoorFilled'
      shortcut={HOME_SHORTCUT}
      iconOnly={variant === 'icon'}
      onNavigate={onNavigate}
    />
  );
  if (desktop || variant === 'icon') return home;
  return (
    <>
      <span aria-hidden className='me-1 grid size-5 shrink-0 place-items-center text-fg-4'>
        <Logo className='size-3.25' />
      </span>
      {home}
    </>
  );
}
