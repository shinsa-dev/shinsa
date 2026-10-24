import { ScrollFade } from '@shinsa/ui/components/scroll-fade';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='card'
      className={cn(
        'group/card corner-superellipse/1.125 relative flex w-full flex-col overflow-hidden rounded-xl bg-card text-card-foreground',
        // The ring is drawn again on top, so a sticky table column or any
        // filled child can never paint over the card's edge.
        "after:corner-superellipse/1.125 after:pointer-events-none after:absolute after:inset-0 after:z-30 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--bg-3)] after:content-['']",
        className
      )}
      {...props}
    />
  );
}

function CardHeader({
  className,
  divider = false,
  ...props
}: React.ComponentProps<'div'> & { divider?: boolean }) {
  return (
    <div
      data-slot='card-header'
      className={cn(
        'grid auto-rows-min items-start gap-px px-3 py-2.5 has-data-[slot=card-description]:grid-rows-[auto_auto] group-has-data-[slot=card-content]/card:pb-2.5 sm:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] sm:has-data-[slot=card-action]:gap-x-4',
        divider && 'border-bg-3 [&:has(+_:not([data-slot=empty-state]))]:border-b',
        'relative sm:[&>[data-slot=card-description]]:col-start-1 sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:col-start-2 sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:row-span-2 sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:row-start-1 sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:self-center',
        'max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:[&>[data-slot=card-description]]:order-last max-sm:[&>[data-slot=card-title]]:w-auto max-sm:[&>[data-slot=card-title]]:min-w-0 max-sm:[&>[data-slot=card-title]]:flex-auto max-sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:max-w-full max-sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:overflow-x-auto max-sm:[&>[data-slot=card-title]~*:not([data-slot=card-description])]:py-1',
        className
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='card-title'
      className={cn('flex w-full items-center gap-1 font-medium text-fg-4 leading-tighter', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='card-description'
      className={cn('w-full text-pretty text-fg-2 text-xs', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  const ref = React.useRef<HTMLDivElement>(null);
  return (
    <>
      <div
        ref={ref}
        data-slot='card-action'
        className={cn('flex min-w-0 items-center', className)}
        {...props}
      />
      <ScrollFade orientation='horizontal' size={16} targetRef={ref} />
    </>
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot='card-content' className={cn('flex flex-col gap-3 px-3 pb-3', className)} {...props} />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='card-footer'
      className={cn('flex min-h-10 items-center justify-between border-bg-3 border-t px-3 py-1.5', className)}
      {...props}
    />
  );
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
