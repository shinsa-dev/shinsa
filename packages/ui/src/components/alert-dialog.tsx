'use client';

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import { Button } from '@shinsa/ui/components/button';
import { DIALOG_HEADER_STICKY, DIALOG_MOTION, DIALOG_SCRIM_MOTION } from '@shinsa/ui/components/dialog';

import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot='alert-dialog' {...props} />;
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return <AlertDialogPrimitive.Trigger data-slot='alert-dialog-trigger' {...props} />;
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return <AlertDialogPrimitive.Portal data-slot='alert-dialog-portal' {...props} />;
}

function AlertDialogOverlay({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot='alert-dialog-overlay'
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

function AlertDialogContent({
  className,
  size = 'default',
  children,
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  size?: 'default' | 'sm';
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot='alert-dialog-content'
        data-reduced-motion='fade'
        data-size={size}
        className={cn(
          'group/alert-dialog-content corner-superellipse/1.125 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-background text-fg-3 shadow-md outline-none data-[size=default]:w-[min(26.25rem,calc(100vw-2rem))] data-[size=sm]:w-[min(20rem,calc(100vw-2rem))] max-sm:max-h-[calc(100dvh-1.5rem)] max-sm:data-[size=default]:w-[calc(100vw-1.5rem)]',
          DIALOG_MOTION,
          className
        )}
        {...props}
      >
        <div data-slot='alert-dialog-body' className='grid min-h-0 flex-1 gap-3 overflow-y-auto p-4'>
          {children}
        </div>
      </AlertDialogPrimitive.Popup>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-dialog-header'
      className={cn('flex flex-col items-center text-center', DIALOG_HEADER_STICKY, className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-dialog-footer'
      // Actions split the width evenly and fill it — one button simply spans it.
      className={cn('flex w-full gap-2 *:flex-1', className)}
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot='alert-dialog-title'
      className={cn('text-center text-sm leading-tighter font-medium text-balance text-fg-4', className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot='alert-dialog-description'
      className={cn(
        'line-clamp-2 text-center text-xs text-pretty text-fg-2 *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-fg-4 *:[a]:active:text-fg-4',
        className
      )}
      {...props}
    />
  );
}

function AlertDialogAction({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button data-slot='alert-dialog-action' className={cn(className)} {...props} />;
}

function AlertDialogCancel({
  className,
  variant = 'secondary',
  size = 'default',
  ...props
}: AlertDialogPrimitive.Close.Props & Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <AlertDialogPrimitive.Close
      data-slot='alert-dialog-cancel'
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
