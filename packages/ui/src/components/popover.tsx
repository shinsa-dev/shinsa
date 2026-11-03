import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { POPUP_SIDE_SLIDE, POPUP_SURFACE, POPUP_ZOOM } from '@shinsa/ui/lib/popup';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot='popover' {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot='popover-trigger' {...props} />;
}

function PopoverContent({
  className,
  align = 'center',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  anchor,
  collisionAvoidance,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset' | 'anchor' | 'collisionAvoidance'
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
        collisionAvoidance={collisionAvoidance}
        className='isolate z-50'
      >
        <PopoverPrimitive.Popup
          data-slot='popover-content'
          className={cn(
            POPUP_SURFACE,
            POPUP_SIDE_SLIDE,
            POPUP_ZOOM,
            'z-50 flex w-64 flex-col gap-2 p-2.5 text-xs outline-hidden duration-200',
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot='popover-header' className={cn('flex flex-col text-xs', className)} {...props} />;
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot='popover-title'
      className={cn('font-medium text-fg-4', className)}
      {...props}
    />
  );
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot='popover-description'
      className={cn('text-pretty text-fg-2', className)}
      {...props}
    />
  );
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger };
