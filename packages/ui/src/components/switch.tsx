'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';

import { cn } from '@shinsa/ui/lib/utils';

// One size. Geometry is driven by the 12px knob: 2px inset on every side makes
// the track 16 tall and 24 wide, and the checked translate of `thumb - 3` lands
// the knob flush against the right edge.
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot='switch'
      className={cn(
        'peer group/switch relative inline-flex h-4 w-6 shrink-0 items-center rounded-full border border-transparent bg-bg-3 transition-[background-color,box-shadow] duration-200 ease-out',
        'outline-none',
        'after:absolute after:-inset-x-3 after:-inset-y-2',
        'not-data-disabled:cursor-pointer data-checked:bg-primary-4',
        'data-disabled:cursor-not-allowed data-disabled:[&>span]:opacity-50',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot='switch-thumb'
        className={cn(
          'pointer-events-none flex size-3 items-center justify-center rounded-full bg-background text-primary-4 ring-0 transition-transform duration-150 ease-out',
          'shadow-control-knob',
          'translate-x-px data-checked:translate-x-[calc(100%-3px)]'
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
