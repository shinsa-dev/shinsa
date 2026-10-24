import { describe, expect, it, mock } from 'bun:test';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';

function Harness({ title, onConfirm }: { title: string; onConfirm: () => void }) {
  const dialog = useDialogState<'remove'>();
  return (
    <>
      <button type='button' onClick={() => dialog.show('remove')}>
        Remove
      </button>
      {dialog.value && (
        <ConfirmDialog
          control={dialog.control}
          title={title}
          body='Shinsa signs this account out.'
          action='Remove account'
          onConfirm={onConfirm}
        />
      )}
    </>
  );
}

async function openConfirm(onConfirm = mock()) {
  const view = render(<Harness title='Remove a@example.com?' onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await screen.findByRole('alertdialog');
  return view;
}

describe('the confirm dialog', () => {
  it('keeps its text while it closes after Keep it, and runs nothing', async () => {
    const onConfirm = mock();
    const view = await openConfirm(onConfirm);

    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    view.rerender(<Harness title='Remove b@example.com?' onConfirm={onConfirm} />);
    expect(screen.getByText('Remove a@example.com?')).toBeTruthy();
    expect(screen.queryByText('Remove b@example.com?')).toBeNull();

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('acts only once it has closed, so nothing changes under it', async () => {
    const onConfirm = mock();
    await openConfirm(onConfirm);

    fireEvent.click(screen.getByRole('button', { name: 'Remove account' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Remove a@example.com?')).toBeTruthy();

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
