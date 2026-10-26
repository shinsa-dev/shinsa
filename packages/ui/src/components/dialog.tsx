'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shinsa/ui/components/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

/**
 * How a dialog and its scrim come and go: a fade with a scale from 0.96 over
 * 150ms on the way in, 100ms on the way out. `starting:` covers a dialog that
 * mounts already open (`useDialogState`), which never gets base-ui's
 * `data-starting-style`. Under reduced motion only the fade is kept
 * (`data-reduced-motion="fade"` spares it from the global reset).
 */
export const DIALOG_MOTION =
  'transition-[opacity,scale] duration-150 ease-out data-ending-style:duration-100 starting:scale-96 starting:opacity-0 data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 motion-reduce:starting:scale-100 motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100';

export const DIALOG_SCRIM_MOTION =
  'transition-opacity duration-150 ease-out data-ending-style:duration-100 starting:opacity-0 data-starting-style:opacity-0 data-ending-style:opacity-0';

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot='dialog' {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot='dialog-trigger' {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot='dialog-portal' {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot='dialog-close' {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot='dialog-overlay'
      data-reduced-motion='fade'
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/10 dark:bg-black/55',
        DIALOG_SCRIM_MOTION,
        className
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  overlayClassName,
  children,
  showCloseButton = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  /** Classes for the scrim behind it, such as a faster motion to match the popup's. */
  overlayClassName?: string;
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Popup
        data-slot='dialog-content'
        data-reduced-motion='fade'
        className={cn(
          'corner-superellipse/1.125 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(26.25rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 overflow-y-auto rounded-xl bg-background p-4 text-fg-3 shadow-md outline-none',
          DIALOG_MOTION,
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && <DialogCloseButton />}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

/** The corner X of a dialog or sheet: an icon button named "Close" in its label and its tooltip. */
function DialogCloseButton({ className, ...props }: DialogPrimitive.Close.Props) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <DialogPrimitive.Close
            data-slot='dialog-close'
            aria-label='Close'
            render={
              <Button
                variant='secondary'
                size='icon-sm'
                className={cn('absolute top-3 right-3', className)}
              />
            }
            {...props}
          />
        }
      >
        <Icon name='IconCrossMedium' />
      </TooltipTrigger>
      <TooltipContent>Close</TooltipContent>
    </Tooltip>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='dialog-header'
      className={cn('flex w-full flex-col items-center gap-px text-center', className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  return (
    <div data-slot='dialog-footer' className={cn('flex w-full gap-2 *:flex-1', className)} {...props}>
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant='secondary' />}>Close</DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot='dialog-title'
      className={cn('text-balance text-center font-medium text-fg-4 text-sm leading-tighter', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot='dialog-description'
      className={cn(
        'text-pretty text-center text-fg-2 text-xs *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-fg-4 *:[a]:active:text-fg-4',
        className
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
