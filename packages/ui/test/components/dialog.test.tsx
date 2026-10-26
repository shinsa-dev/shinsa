import { describe, expect, it, mock } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../../src/components/alert-dialog';
import { Command, CommandDialog, CommandInput } from '../../src/components/command';
import { Dialog, DialogContent, DialogTitle } from '../../src/components/dialog';
import { Sheet, SheetContent, SheetTitle } from '../../src/components/sheet';
import { flush } from '../support/layout';

describe('the corner close button', () => {
  it('closes a sheet and is named Close', async () => {
    const onOpenChange = mock();
    render(
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetTitle>Queue</SheetTitle>
        </SheetContent>
      </Sheet>
    );
    await act(() => flush());
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.dataset.slot).toBe('sheet-close');
    await act(async () => {
      fireEvent.click(close);
      await flush();
    });
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
  });

  it('is optional on a dialog', async () => {
    const view = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Rename</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    await act(() => flush());
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();

    view.rerender(
      <Dialog open>
        <DialogContent showCloseButton>
          <DialogTitle>Rename</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByRole('button', { name: 'Close' }).dataset.slot).toBe('dialog-close');
  });
});

describe('a dialog’s entry', () => {
  it('animates in even when it mounts already open, at a width set by its size alone', async () => {
    render(
      <>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Rename</DialogTitle>
          </DialogContent>
        </Dialog>
        <AlertDialog open>
          <AlertDialogContent size='sm'>
            <AlertDialogTitle>Remove?</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
    await act(() => flush());
    for (const slot of ['dialog-content', 'dialog-overlay', 'alert-dialog-content', 'alert-dialog-overlay']) {
      const element = document.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
      expect(element?.className).toContain('starting:opacity-0');
      expect(element?.dataset.reducedMotion).toBe('fade');
    }
    for (const slot of ['dialog-content', 'alert-dialog-content']) {
      const classes = document.querySelector(`[data-slot="${slot}"]`)?.className ?? '';
      expect(classes).toContain('starting:scale-96');
      expect(classes).not.toContain('w-full');
    }
    expect(document.querySelector('[data-slot="alert-dialog-content"]')?.className).toContain(
      'data-[size=sm]:w-[min(20rem,calc(100vw-2rem))]'
    );
  });
});

describe('the command menu’s entry', () => {
  it('comes and goes in 75ms each way, much faster than a dialog, its scrim in step, and fades alone under reduced motion', async () => {
    render(
      <>
        <CommandDialog open>
          <Command>
            <CommandInput placeholder='Search' />
          </Command>
        </CommandDialog>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Rename</DialogTitle>
          </DialogContent>
        </Dialog>
      </>
    );
    await act(() => flush());
    const [menu, dialog] = document.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]');
    const [menuScrim, dialogScrim] = document.querySelectorAll<HTMLElement>('[data-slot="dialog-overlay"]');
    const classes = (element: HTMLElement | undefined) => (element?.className ?? '').split(' ');
    expect(classes(menu)).toEqual(expect.arrayContaining(['duration-75', 'data-ending-style:duration-75']));
    expect(classes(menu)).not.toContain('duration-90');
    expect(classes(menu)).not.toContain('data-ending-style:duration-100');
    expect(classes(menu)).toEqual(
      expect.arrayContaining(['starting:scale-98', 'motion-reduce:starting:scale-100'])
    );
    expect(classes(menu)).not.toContain('duration-150');
    expect(classes(menu)).not.toContain('starting:scale-96');
    expect(classes(menuScrim)).toEqual(
      expect.arrayContaining(['duration-75', 'data-ending-style:duration-75'])
    );
    expect(classes(menuScrim)).not.toContain('duration-150');
    expect(classes(menuScrim)).not.toContain('data-ending-style:duration-100');
    expect(classes(dialog)).toEqual(expect.arrayContaining(['duration-150', 'starting:scale-96']));
    expect(classes(dialogScrim)).toContain('duration-150');
  });
});
