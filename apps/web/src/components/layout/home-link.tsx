import * as React from 'react';
import { BrandLink } from '@/components/layout/brand-link.tsx';
import { NavButton } from '@/components/layout/nav-button.tsx';
import { DesktopChrome, HOME_SHORTCUT, isDesktop } from '@/lib/desktop.ts';

export function HomeLink({
  onNavigate,
  brandClassName,
}: {
  onNavigate?: () => void;
  brandClassName?: string;
}) {
  const chrome = React.useContext(DesktopChrome);
  if (chrome || isDesktop())
    return (
      <NavButton
        page='home'
        label='Home'
        icon='IconHomeRoundDoor'
        activeIcon='IconHomeRoundDoorFilled'
        shortcut={HOME_SHORTCUT}
        onNavigate={onNavigate}
      />
    );
  return <BrandLink onNavigate={onNavigate} className={brandClassName} />;
}
