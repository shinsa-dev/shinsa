import { describe, expect, it, mock } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
