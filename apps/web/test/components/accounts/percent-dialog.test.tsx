import { describe, expect, it } from 'bun:test';
import type { AccountSummary } from '@shinsa/core';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PercentDialog } from '@/components/accounts/percent-dialog.tsx';
import { createAccount } from '../../support/accounts.ts';

function Harness({ account, onSave }: { account: AccountSummary; onSave: () => Promise<boolean> }) {
  const dialog = useDialogState<'other'>();
  return (
    <>
      <button type='button' onClick={() => dialog.show('other')}>
        Other
      </button>
      {dialog.value && (
        <PercentDialog control={dialog.control} account={account} initial={70} onSave={onSave} />
      )}
    </>
  );
}

async function waitForClosed() {
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Percentage' })).toBeNull());
}

function field() {
  return screen.getByRole('textbox', { name: 'Percentage' }) as HTMLInputElement;
}

async function openPercent(onSave: () => Promise<boolean>) {
  const account = createAccount({ id: 'a' });
  const view = render(<Harness account={account} onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: 'Other' }));
  await screen.findByRole('textbox', { name: 'Percentage' });
  return { view, account };
}

describe('the percentage dialog', () => {
  it('keeps the typed value and its error while it closes after Cancel, and starts fresh next time', async () => {
    await openPercent(() => Promise.resolve(true));
    fireEvent.change(field(), { target: { value: '150' } });
    fireEvent.submit(field().closest('form') as HTMLFormElement);
    expect(screen.getByRole('alert').textContent).toBe('Enter a whole percentage from 1 to 100.');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(field().value).toBe('150');
    expect(screen.getByRole('alert')).toBeTruthy();

    await waitForClosed();

    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    expect(((await screen.findByRole('textbox', { name: 'Percentage' })) as HTMLInputElement).value).toBe(
      '70'
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays busy until it has closed after a save', async () => {
    const saved = Promise.withResolvers<boolean>();
    await openPercent(() => saved.promise);
    fireEvent.change(field(), { target: { value: '85' } });
    fireEvent.submit(field().closest('form') as HTMLFormElement);
    const save = screen.getByRole('button', { name: /Save percentage/ });
    expect(save.getAttribute('aria-busy')).toBe('true');

    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(save, { attributes: true, attributeFilter: ['aria-busy'] });
    saved.resolve(true);
    await act(() => saved.promise);
    await waitForClosed();
    changes.push(...observer.takeRecords());
    observer.disconnect();
    expect(changes).toEqual([]);
  });

  it('keeps its description while it closes', async () => {
    const { view, account } = await openPercent(() => Promise.resolve(true));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    view.rerender(
      <Harness account={{ ...account, email: 'renamed@example.com' }} onSave={() => Promise.resolve(true)} />
    );
    expect(screen.getByText(/a@example\.com/)).toBeTruthy();
    expect(screen.queryByText(/renamed@example\.com/)).toBeNull();
    await waitForClosed();
  });

  it('stays open and ready again when the save is refused', async () => {
    await openPercent(() => Promise.resolve(false));
    fireEvent.change(field(), { target: { value: '85' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save percentage' }));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save percentage' }).getAttribute('aria-busy')).toBeNull()
    );
    expect(field().value).toBe('85');
  });
});
