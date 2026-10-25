'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { useAnimatedIndicator } from '@shinsa/ui/hooks/use-animated-indicator';
import { cn } from '@shinsa/ui/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

function Tabs({ className, orientation = 'horizontal', ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot='tabs'
      data-orientation={orientation}
      className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  'group/tabs-list relative isolate inline-flex w-fit items-center justify-center group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col',
  {
    variants: {
      variant: {
        default:
          'corner-superellipse/1.125 gap-1 rounded-control bg-bg-2 p-0.5 group-data-horizontal/tabs:h-6.5',
        ghost: 'gap-3 bg-transparent group-data-horizontal/tabs:h-6.5',
        underline: 'gap-1 bg-transparent group-data-horizontal/tabs:h-8',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function TabsList({
  className,
  variant = 'default',
  children,
  ref,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(ref, () => listRef.current as HTMLDivElement, []);
  // The active pill slides between tabs instead of cross-fading.
  const indicatorRef = useAnimatedIndicator(listRef, { attribute: 'data-active', press: false });

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot='tabs-list'
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {variant === 'underline' ? (
        // Placed from the list's top-left by the tab's own offsets: Base UI
        // derives the bottom offset from scrollHeight, which a touch target's
        // overflow inflates. The line sits on the list's bottom edge instead.
        <TabsPrimitive.Indicator
          data-slot='tab-indicator'
          className='absolute bottom-0 left-0 z-10 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-px rounded-full bg-primary transition-[width,translate] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'
        />
      ) : null}
      {variant === 'default' ? (
        <div
          ref={indicatorRef}
          aria-hidden
          className='corner-superellipse/1.125 pointer-events-none absolute top-0 left-0 -z-10 rounded-segment bg-background opacity-0 shadow-1 dark:bg-bg-4'
          style={{ willChange: 'transform, opacity', contain: 'layout paint', transformOrigin: 'center' }}
        />
      ) : null}
      {children}
    </TabsPrimitive.List>
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot='tabs-trigger'
      className={cn(
        'relative inline-flex cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium text-fg-2 text-xs outline-none',
        'hover:text-fg-4 active:text-fg-4 data-active:text-fg-4',
        'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
        'group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start',
        '[--icon-size:var(--icon-size-md)] [&_svg]:pointer-events-none',
        // Segmented: full-height tab; the sliding indicator supplies the pill.
        'group-data-[variant=default]/tabs-list:h-full group-data-[variant=default]/tabs-list:rounded-segment group-data-[variant=default]/tabs-list:px-2',
        // Underline: regular weight; the selected tab gains a hairline stroke
        // (faux-medium) so it reads medium without its width changing.
        'group-data-[variant=underline]/tabs-list:data-active:faux-medium group-data-[variant=underline]/tabs-list:h-full group-data-[variant=underline]/tabs-list:px-2 group-data-[variant=underline]/tabs-list:font-normal',
        // Ghost: bare text switchers — no indicator, so the content itself
        // takes the press, exactly like the link button.
        'group-data-[variant=ghost]/tabs-list:enabled:active:scale-[0.975] group-data-[variant=ghost]/tabs-list:[will-change:scale]',
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot='tabs-content'
      className={cn('flex-1 text-sm outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
