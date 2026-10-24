'use client';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@shinsa/ui/components/dialog';
import { DESTRUCTIVE_ITEM } from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { Kbd, KbdGroup } from '@shinsa/ui/components/kbd';
import { type MenuItemIcon, menuIconPosition, renderMenuIcon } from '@shinsa/ui/components/menu-icon';
import { SizeAnimator } from '@shinsa/ui/components/size-animator';
import { useAnimatedIndicator } from '@shinsa/ui/hooks/use-animated-indicator';
import { cn } from '@shinsa/ui/lib/utils';
import { Command as CommandPrimitive } from 'cmdk';
import * as React from 'react';

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot='command'
      loop
      className={cn(
        'flex h-full w-full flex-col overflow-hidden bg-popover text-popover-foreground',
        className
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title = 'Command menu',
  description = 'Search for a page or an action.',
  children,
  className,
  finalFocus,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, 'children'> & {
  title?: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
  finalFocus?: React.ComponentProps<typeof DialogContent>['finalFocus'];
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        finalFocus={finalFocus}
        className={cn(
          'top-[max(3rem,14vh)] translate-y-0 gap-0 overflow-hidden rounded-popup bg-popover p-0 *:data-[slot=command]:bg-transparent sm:max-w-[520px]',
          className
        )}
      >
        <DialogTitle className='sr-only'>{title}</DialogTitle>
        <DialogDescription className='sr-only'>{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  start,
  end,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  start?: React.ReactNode;
  end?: React.ReactNode;
}) {
  return (
    <div
      data-slot='command-input-wrapper'
      className='flex h-10 shrink-0 items-center gap-2 border-bg-3 border-b px-3'
    >
      <Icon name='IconMagnifyingGlass' size='md' className='text-fg-2' />
      {start}
      <CommandPrimitive.Input
        data-slot='command-input'
        className={cn(
          'min-w-0 flex-1 bg-transparent font-medium text-fg-4 text-xs outline-none placeholder:font-normal placeholder:text-fg-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
      {end}
    </div>
  );
}

function readOffset(element: HTMLElement, list: HTMLElement) {
  const box = element.getBoundingClientRect();
  const frame = list.getBoundingClientRect();
  return { x: box.left - frame.left, y: box.top - frame.top };
}

function useAnimatedPages(
  listRef: React.RefObject<HTMLDivElement | null>,
  indicatorRef: React.RefObject<HTMLDivElement | null>,
  page: string | undefined
) {
  const shown = React.useRef(page);
  const lastScroll = React.useRef(0);
  const scrolls = React.useRef(new Map<string, number>());

  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const remember = () => {
      lastScroll.current = list.scrollTop;
    };
    list.addEventListener('scroll', remember, { passive: true });
    return () => list.removeEventListener('scroll', remember);
  }, [listRef]);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    const indicator = indicatorRef.current;
    const previous = shown.current;
    shown.current = page;
    if (!list || !indicator || page === undefined || previous === undefined || previous === page) return;
    const saved = scrolls.current.get(page);
    if (saved === undefined) scrolls.current.set(previous, lastScroll.current);
    else scrolls.current.delete(page);
    const target = saved ?? 0;
    const visible = indicator.style.opacity === '1';
    const from = readOffset(indicator, list);
    list.scrollTop = target;
    lastScroll.current = target;
    if (visible) {
      const transition = indicator.style.transition;
      indicator.style.transition = 'none';
      indicator.style.transform = `translate(${from.x}px, ${from.y + target}px) scale(var(--hl-press-scale, 1))`;
      void indicator.offsetHeight;
      indicator.style.transition = transition;
    }
    const frame = requestAnimationFrame(() => {
      list
        .querySelector<HTMLElement>('[cmdk-item][data-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [listRef, indicatorRef, page]);
}

function CommandList({
  className,
  ref,
  page,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List> & { page?: string }) {
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(ref, () => listRef.current as HTMLDivElement);
  const indicatorRef = useAnimatedIndicator(listRef, { attribute: 'data-selected', value: 'true' });
  useAnimatedPages(listRef, indicatorRef, page);

  return (
    <SizeAnimator>
      <CommandPrimitive.List
        ref={listRef}
        data-slot='command-list'
        className={cn(
          'scrollbar-hide relative isolate max-h-[min(--spacing(96),60dvh)] scroll-py-1 overflow-y-auto overscroll-contain p-1',
          className
        )}
        {...props}
      >
        <div
          ref={indicatorRef}
          aria-hidden
          className='pointer-events-none absolute top-0 left-0 -z-10 rounded-item bg-bg-a2 opacity-0 data-[variant=destructive]:bg-red-a2'
          style={{ willChange: 'transform, opacity', contain: 'layout paint', transformOrigin: 'center' }}
        />
        {props.children}
      </CommandPrimitive.List>
    </SizeAnimator>
  );
}

function CommandEmpty({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot='command-empty'
      className={cn('py-6 text-center text-fg-2 text-xs', className)}
      {...props}
    />
  );
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot='command-group'
      className={cn(
        'scroll-my-1 overflow-hidden [&_[cmdk-group-heading]]:select-none [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-2 [&_[cmdk-group-heading]]:text-xs [[cmdk-group]:not([hidden])~&]:mt-1',
        className
      )}
      {...props}
    />
  );
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot='command-separator'
      className={cn('-mx-1 my-1 h-px bg-bg-3', className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  children,
  icon,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item> & {
  icon?: MenuItemIcon;
  variant?: 'default' | 'destructive';
}) {
  const position = menuIconPosition(icon);
  return (
    <CommandPrimitive.Item
      data-slot='command-item'
      data-icon={position}
      data-variant={variant}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-1.5 rounded-item py-1 pr-2 pl-2 font-medium text-fg-3 text-xs leading-4 outline-hidden [--icon-size:var(--icon-size-sm)] data-[disabled=true]:pointer-events-none data-indicator-here:text-fg-4 data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none',
        DESTRUCTIVE_ITEM,
        className
      )}
      {...props}
    >
      {renderMenuIcon(icon, 'inline-start')}
      {children}
      {renderMenuIcon(icon, 'inline-end')}
    </CommandPrimitive.Item>
  );
}

function CommandHint({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span data-slot='command-hint' className={cn('truncate font-normal text-fg-2', className)} {...props} />
  );
}

function CommandShortcut({ keys, className }: { keys: string[]; className?: string }) {
  const chips = keys.map((key, index) => ({ key, id: keys.slice(0, index + 1).join('+') }));
  return (
    <KbdGroup data-slot='command-shortcut' className={cn('ml-auto pl-3', className)}>
      {chips.map((chip) => (
        <Kbd key={chip.id}>{chip.key}</Kbd>
      ))}
    </KbdGroup>
  );
}

function CommandFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='command-footer'
      className={cn(
        'flex h-7 shrink-0 items-center gap-3 border-bg-3 border-t px-3 text-fg-2 text-xs [&_kbd]:bg-bg-2',
        className
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
