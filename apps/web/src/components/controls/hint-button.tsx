import { Button } from '@shinsa/ui/components/button';
import type { IconName } from '@shinsa/ui/components/icon';
import type * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';

export function HintButton({
  label,
  icon,
  size,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'variant' | 'size' | 'icon' | 'children' | 'aria-label'> & {
  label: string;
  icon: IconName;
  size: 'icon-xs' | 'icon-sm';
}) {
  return (
    <Hint label={label}>
      <Button variant='secondary' size={size} icon={icon} aria-label={label} {...props} />
    </Hint>
  );
}
