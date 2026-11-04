'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
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

/**
 * A dialog's header stays put while its body scrolls under it: it sticks to
 * the top of the body's scroller, bleeding over the body's padding so nothing
 * shows above it, and fades the content scrolling in below it
 * (`dialog-header-fade` in globals.css). Shared with `AlertDialogHeader`.
 */
export const DIALOG_HEADER_STICKY =
  'sticky -top-4 z-10 -mx-4 -mt-4 w-auto self-stretch bg-background px-4 pt-4 dialog-header-fade';

/**
 * The part of a dialog that scrolls. The popup itself never scrolls, so the
 * corner close button (absolute to the popup) stays put, and the body is not
 * positioned, so nothing absolute inside it scrolls with it by accident.
 */
export const DIALOG_BODY = 'flex min-h-0 w-full flex-1 flex-col items-center gap-3 overflow-y-auto p-4';

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
  bodyClassName,
  overlayClassName,
  children,
  showCloseButton = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  /** Classes for the scrolling body inside the popup, such as `p-0` for content that scrolls on its own. */
  bodyClassName?: string;
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
          'corner-superellipse/1.125 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(26.25rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-background text-fg-3 shadow-md outline-none max-sm:max-h-[calc(100dvh-1.5rem)] max-sm:w-[calc(100vw-1.5rem)]',
          DIALOG_MOTION,
          className
        )}
        {...props}
      >
        <div data-slot='dialog-body' className={cn(DIALOG_BODY, bodyClassName)}>
          {children}
          {showCloseButton && <DialogCloseButton />}
        </div>
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

/** The corner X of a dialog or sheet: an icon button named "Close". An X in the corner says it, so no tooltip. */
function DialogCloseButton({ className, ...props }: DialogPrimitive.Close.Props) {
  return (
    <DialogPrimitive.Close
      data-slot='dialog-close'
      aria-label='Close'
      render={
        <Button variant='secondary' size='icon-sm' className={cn('absolute top-3 right-3 z-20', className)} />
      }
      {...props}
    >
      <Icon name='IconCrossMedium' />
    </DialogPrimitive.Close>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='dialog-header'
      className={cn('flex flex-col items-center gap-px text-center', DIALOG_HEADER_STICKY, className)}
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
      className={cn('text-center text-sm leading-tighter font-medium text-balance text-fg-4', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot='dialog-description'
      className={cn(
        'text-center text-xs text-pretty text-fg-2 *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-fg-4 *:[a]:active:text-fg-4',
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
