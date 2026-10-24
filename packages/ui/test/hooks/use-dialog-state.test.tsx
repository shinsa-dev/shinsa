import { describe, expect, it } from 'bun:test';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../../src/components/dialog';
import { useDialogState, useHeldValue } from '../../src/hooks/use-dialog-state';
import { flush } from '../support/layout';

describe('useDialogState', () => {
  it('keeps the value while the dialog closes and clears it once the exit ends', () => {
    const { result } = renderHook(() => useDialogState<string>());
    expect(result.current.value).toBeNull();
    expect(result.current.control.open).toBe(false);

    act(() => result.current.show('remove'));
    expect(result.current.value).toBe('remove');
    expect(result.current.open).toBe(true);

    act(() => result.current.control.onOpenChange(true));
    expect(result.current.open).toBe(true);

    act(() => result.current.control.onOpenChange(false));
    expect(result.current.open).toBe(false);
    expect(result.current.value).toBe('remove');

    act(() => result.current.control.onOpenChangeComplete(true));
    expect(result.current.value).toBe('remove');

    act(() => result.current.control.onOpenChangeComplete(false));
    expect(result.current.value).toBeNull();
  });

  it('keeps a dialog reopened during its exit', () => {
    const { result } = renderHook(() => useDialogState<string>());
    act(() => result.current.show('switch'));
    act(() => result.current.close());
    act(() => result.current.show('remove'));
    act(() => result.current.control.onOpenChangeComplete(false));
    expect(result.current.value).toBe('remove');
    expect(result.current.open).toBe(true);
  });

  it('unmounts a dialog only after Base UI says its exit ended', async () => {
    function Harness() {
      const dialog = useDialogState<string>();
      return (
        <>
          <button type='button' onClick={() => dialog.show('Rename')}>
            Open
          </button>
          <output aria-label='Value'>{dialog.value ?? 'none'}</output>
          {dialog.value && (
            <Dialog {...dialog.control}>
              <DialogContent>
                <DialogTitle>{dialog.value}</DialogTitle>
                <DialogClose>Cancel</DialogClose>
              </DialogContent>
            </Dialog>
          )}
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await act(() => flush());
    expect(screen.getByText('Rename', { selector: 'h2' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('status', { name: 'Value' }).textContent).toBe('Rename');

    await act(() => flush());
    expect(screen.getByRole('status', { name: 'Value' }).textContent).toBe('none');
  });
});

describe('useHeldValue', () => {
  it('follows the value while open and keeps the last open one while closed', () => {
    const { result, rerender } = renderHook(({ value, open }) => useHeldValue(value, open), {
      initialProps: { value: 'Signing in', open: true },
    });
    expect(result.current).toBe('Signing in');

    rerender({ value: 'Signed in', open: true });
    expect(result.current).toBe('Signed in');

    rerender({ value: 'Starting', open: false });
    expect(result.current).toBe('Signed in');

    rerender({ value: 'Starting again', open: true });
    expect(result.current).toBe('Starting again');
  });
});
