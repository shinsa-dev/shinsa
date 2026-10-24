import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Toaster, toast } from '../../src/components/sonner';
import { flush } from '../support/layout';

function findToast(text: string) {
  return screen
    .findByText(text)
    .then((node) => node.closest<HTMLElement>('[data-sonner-toast]') as HTMLElement);
}

function show(fire: () => unknown) {
  let result: unknown;
  act(() => {
    result = fire();
  });
  return result;
}

function waitForCue(element: HTMLElement, cue: 'bk-toast-bump' | 'bk-toast-shake') {
  return waitFor(() => expect(element.classList.contains(cue)).toBe(true));
}

beforeEach(() => {
  render(<Toaster />);
});

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

describe('toast', () => {
  it('shows each kind as its own toast at the top centre', async () => {
    show(() => toast.success('Saved'));
    show(() => toast('Plain'));
    show(() => toast.error('Broke'));
    show(() => toast.warning('Careful'));
    show(() => toast.info('Note'));

    const kinds = await Promise.all(['Saved', 'Plain', 'Broke', 'Careful', 'Note'].map(findToast));
    expect(kinds.map((element) => element.dataset.type)).toEqual([
      'success',
      undefined,
      'error',
      'warning',
      'info',
    ]);
    expect(kinds[0]?.dataset.yPosition).toBe('top');
    expect(kinds[0]?.dataset.xPosition).toBe('center');
  });

  it('updates a duplicate on top in place and bumps it instead of stacking a copy', async () => {
    const first = show(() => toast('Copied'));
    const element = await findToast('Copied');

    expect(show(() => toast('Copied'))).toBe(first);
    await waitForCue(element, 'bk-toast-bump');
    expect(screen.getAllByText('Copied')).toHaveLength(1);
  });

  it('shakes a repeated error', async () => {
    show(() => toast.error('No connection'));
    const element = await findToast('No connection');
    show(() => toast.error('No connection'));
    await waitForCue(element, 'bk-toast-shake');
  });

  it('brings a buried duplicate back to the top as a new toast, and bumps it', async () => {
    const first = show(() => toast('Queued'));
    await findToast('Queued');
    show(() => toast('Later'));
    await findToast('Later');

    const again = show(() => toast('Queued'));
    expect(again).not.toBe(first);
    await waitFor(() => {
      const top = document.querySelector<HTMLElement>('[data-sonner-toast]');
      expect(top?.textContent).toBe('Queued');
      expect(top?.classList.contains('bk-toast-bump')).toBe(true);
    });
  });

  it('forgets a toast once it is dismissed, and still tells the caller', async () => {
    const onDismiss = mock();
    const first = show(() => toast('Once', { onDismiss }));
    await findToast('Once');

    act(() => {
      toast.dismiss(first as string);
    });
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(show(() => toast('Once'))).not.toBe(first);
  });

  it('forgets a toast once it closes itself, and still tells the caller', async () => {
    const onAutoClose = mock();
    const first = show(() => toast('Brief', { onAutoClose, duration: 1 }));
    await waitFor(() => expect(onAutoClose).toHaveBeenCalledTimes(1));
    expect(show(() => toast('Brief'))).not.toBe(first);
  });

  it('never dedupes a message that is not a string', async () => {
    show(() => toast(<b>Node</b>));
    show(() => toast(<b>Node</b>));
    await waitFor(() => expect(screen.getAllByText('Node')).toHaveLength(2));
  });

  it('passes a caller id straight through', () => {
    expect(show(() => toast('Mine', { id: 'fixed' }))).toBe('fixed');
  });

  it('settles a loading toast in place with the result kind', async () => {
    const id = show(() => toast.loading('Saving')) as string;
    const loading = await findToast('Saving');
    expect(loading.dataset.type).toBe('loading');

    expect(show(() => toast.info('Saved', { id }))).toBe(id);
    const settled = await findToast('Saved');
    await waitFor(() => expect(settled.dataset.type).toBe('info'));
    expect(screen.queryByText('Saving')).toBeNull();
    await waitForCue(settled, 'bk-toast-bump');
  });

  it('fails a loading toast with a warning, and shakes it', async () => {
    const id = show(() => toast.loading('Pushing', { id: 'push' }));
    expect(id).toBe('push');
    await findToast('Pushing');
    show(() => toast.warning('Rejected', { id: 'push' }));
    const failed = await findToast('Rejected');
    await waitFor(() => expect(failed.dataset.type).toBe('warning'));
    await waitForCue(failed, 'bk-toast-shake');
  });

  it('lets a dismissed loading toast be followed by a fresh toast with the same id', async () => {
    const id = show(() => toast.loading('Deploying')) as string;
    await findToast('Deploying');
    act(() => {
      toast.dismiss(id);
    });
    show(() => toast.success('Deployed', { id }));
    expect((await findToast('Deployed')).dataset.type).toBe('success');

    const other = show(() => toast.loading('Again')) as string;
    act(() => {
      toast.dismiss();
    });
    show(() => toast.error('Failed', { id: other }));
    expect((await findToast('Failed')).dataset.type).toBe('error');
  });

  it('returns a plain id from a promise toast, and none when it shows nothing', () => {
    const id = show(() => toast.promise(Promise.resolve(1), { loading: 'Working', id: 'work' }));
    expect(id).toBe('work');
    const counted = show(() => toast.promise(Promise.resolve(1), { loading: 'Counting', id: 7 }));
    expect(counted).toBe(7);
    expect(show(() => toast.promise(() => Promise.resolve(1), {}))).toBeUndefined();
  });

  it('passes custom and message toasts through', async () => {
    show(() => toast.custom(() => <div>Custom body</div>));
    show(() => toast.message('Hello'));
    expect(await screen.findByText('Custom body')).toBeTruthy();
    expect(await screen.findByText('Hello')).toBeTruthy();
  });
});

describe('Toaster', () => {
  it('cues only its own toasts when their type settles', async () => {
    const element = document.createElement('li');
    element.setAttribute('data-sonner-toast', '');
    element.className = 'bk-toast';
    element.setAttribute('data-type', 'loading');
    const other = document.createElement('li');
    other.setAttribute('data-type', 'loading');
    document.body.append(element, other);

    await act(async () => {
      await flush();
      element.setAttribute('data-type', 'custom');
      other.setAttribute('data-type', 'success');
      await flush();
    });
    expect(element.classList.contains('bk-toast-bump')).toBe(true);
    expect(other.classList.length).toBe(0);
    element.remove();
    other.remove();
  });
});
