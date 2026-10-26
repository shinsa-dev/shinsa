import type { TerminalPlace } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { PLACE_ICONS, type PlaceGroup } from '@/lib/terminal/tabs.ts';

export function NewTerminalButton({
  groups,
  fallback,
  label = 'New terminal',
  wide = false,
  onOpen,
}: {
  groups: PlaceGroup[];
  fallback: TerminalPlace | null;
  label?: string;
  wide?: boolean;
  onOpen: (place: TerminalPlace) => void;
}) {
  const places = groups.flatMap((group) => group.places);
  const only = places.length <= 1 ? (places[0] ?? fallback) : null;
  const trigger = wide ? (
    <Button size='sm' icon='IconPlusMedium'>
      {label}
    </Button>
  ) : (
    <Button variant='secondary' size='icon-sm' icon='IconPlusMedium' aria-label={label} />
  );
  if (only) {
    const button = React.cloneElement(trigger, { onClick: () => onOpen(only) });
    if (wide) return button;
    return (
      <Hint label={label} detail={only.path}>
        {button}
      </Hint>
    );
  }
  const menuTrigger = <DropdownMenuTrigger render={trigger} />;
  return (
    <DropdownMenu>
      {wide ? menuTrigger : <Hint label={label}>{menuTrigger}</Hint>}
      <DropdownMenuContent align={wide ? 'center' : 'start'} className='min-w-60 max-w-96'>
        {groups.map((group, index) => (
          <React.Fragment key={group.kind}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{group.heading}</DropdownMenuLabel>
              {group.places.map((place) => (
                <DropdownMenuItem key={place.path} onClick={() => onOpen(place)}>
                  <Icon name={PLACE_ICONS[place.kind]} />
                  <span className='truncate'>{place.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
