'use client';

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { useMediaQuery } from '@shinsa/ui/hooks/use-media-query';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

const TooltipTapContext = React.createContext<React.Dispatch<React.SetStateAction<boolean>> | null>(null);

function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot='tooltip-provider' delay={delay} {...props} />;
}

/**
 * On a device without hover a tooltip opens and closes on tap instead, unless
 * the caller controls `open` itself.
 */
function Tooltip({ open, onOpenChange, ...props }: TooltipPrimitive.Root.Props) {
  const hasHover = useMediaQuery('(hover: hover)', true);
  const [tapOpen, setTapOpen] = React.useState(false);

  const openedByTap = !hasHover && open === undefined;

  const handleOpenChange: TooltipPrimitive.Root.Props['onOpenChange'] = (nextOpen, details) => {
    if (openedByTap) {
      if (nextOpen) return;
      setTapOpen(false);
    }
    onOpenChange?.(nextOpen, details);
  };

  return (
    <TooltipTapContext.Provider value={openedByTap ? setTapOpen : null}>
      <TooltipPrimitive.Root
        data-slot='tooltip'
        open={openedByTap ? tapOpen : open}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </TooltipTapContext.Provider>
  );
}

function TooltipTrigger({ onClick, ...props }: TooltipPrimitive.Trigger.Props) {
  const setTapOpen = React.useContext(TooltipTapContext);

  const handleClick: TooltipPrimitive.Trigger.Props['onClick'] = (event) => {
    setTapOpen?.((previous) => !previous);
    onClick?.(event);
  };

  return (
    <TooltipPrimitive.Trigger
      data-slot='tooltip-trigger'
      closeOnClick={setTapOpen ? false : undefined}
      onClick={handleClick}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className='isolate z-50'
      >
        {/* A compact popover-coloured chip with a hairline border and no arrow; the offset alone reads as attached. */}
        <TooltipPrimitive.Popup
          data-slot='tooltip-content'
          className={cn(
            'corner-superellipse/1.125 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 inline-flex min-h-6 w-fit max-w-72 origin-(--transform-origin) items-center gap-1 rounded-control border border-border bg-popover px-2 py-1 text-2xs text-fg-4 leading-[1.35] has-data-[slot=kbd]:py-0.5 has-data-[slot=kbd]:pr-0.5 data-[state=delayed-open]:animate-in data-closed:animate-out data-open:animate-in **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:h-4 **:data-[slot=kbd]:rounded-sm **:data-[slot=kbd]:bg-bg-a2 **:data-[slot=kbd]:text-fg-3',
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

function TooltipLabel({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot='tooltip-label' className={cn('text-fg-2', className)} {...props} />;
}

export { Tooltip, TooltipContent, TooltipLabel, TooltipProvider, TooltipTrigger };
