import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, render } from '@testing-library/react';
import type * as React from 'react';
import type { ExternalToast } from 'sonner';
import { flush } from '../support/layout';

type Call = { kind: string; message: unknown; options: ExternalToast };

const calls: Call[] = [];
const promised: { promise: Promise<unknown>; data: Record<string, unknown> }[] = [];
let promiseHandle: unknown = null;

function record(kind: string) {
  return (text: unknown, options: ExternalToast = {}) => {
    calls.push({ kind, message: text, options });
    return options.id ?? 'sonner-id';
  };
}

const dismiss = mock((id?: string | number) => id);
const custom = mock(() => 'custom-id');
const message = mock(() => 'message-id');

mock.module('sonner', () => ({
  toast: Object.assign(record('default'), {
    success: record('success'),
    error: record('error'),
    warning: record('warning'),
    info: record('info'),
    dismiss,
    custom,
    message,
    promise: (promise: Promise<unknown>, data: Record<string, unknown>) => {
      promised.push({ promise, data });
      return promiseHandle;
    },
  }),
  Toaster: (props: Record<string, unknown>) => (
    <div data-testid='toaster' data-position={String(props.position)} />
  ),
}));

const { Toaster, toast } = await import('../../src/components/sonner');

function showToast(instance: string, { top = true }: { top?: boolean } = {}) {
  const toaster = document.createElement('section');
  toaster.setAttribute('data-sonner-toaster', '');
  if (!top) {
    const newer = document.createElement('li');
    newer.setAttribute('data-sonner-toast', '');
    toaster.append(newer);
  }
  const item = document.createElement('li');
  item.setAttribute('data-sonner-toast', '');
  item.className = instance;
  toaster.append(item);
  document.body.append(toaster);
  return item;
}

function instanceOf(call: Call) {
  return String(call.options.className).split(' ')[0] as string;
}

beforeEach(() => {
  calls.length = 0;
  promised.length = 0;
  promiseHandle = null;
  dismiss.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
  toast.dismiss();
});

describe('toast', () => {
  it('fires each kind through sonner with its own id and instance class', () => {
    const id = toast.success('Saved');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'success', message: 'Saved' });
    expect(id).toBe(calls[0]?.options.id as string);
    expect(instanceOf(calls[0] as Call)).toMatch(/^bk-toast-i-\d+$/);

    toast('Plain', { className: 'mine' });
    toast.error('Broke');
    toast.warning('Careful');
    toast.info('Note');
    expect(calls.map((call) => call.kind)).toEqual(['success', 'default', 'error', 'warning', 'info']);
    expect(String(calls[1]?.options.className)).toContain('mine');
  });

  it('updates a duplicate on top in place and bumps it instead of stacking a copy', async () => {
    toast('Copied');
    const first = calls[0] as Call;
    const element = showToast(instanceOf(first));

    const id = toast('Copied');
    expect(id).toBe(first.options.id as string);
    await act(() => flush(20));
    expect(element.classList.contains('bk-toast-bump')).toBe(true);
  });

  it('shakes a repeated error', async () => {
    toast.error('No connection');
    const element = showToast(instanceOf(calls[0] as Call));
    toast.error('No connection');
    await act(() => flush(20));
    expect(element.classList.contains('bk-toast-shake')).toBe(true);
  });

  it('brings a buried duplicate back to the top as a new toast', async () => {
    toast('Queued');
    const first = calls[0] as Call;
    showToast(instanceOf(first), { top: false });

    const id = toast('Queued');
    expect(dismiss).toHaveBeenCalledWith(first.options.id);
    expect(id).not.toBe(first.options.id as string);
    const element = showToast(instanceOf(calls[1] as Call));
    await act(() => flush(20));
    expect(element.classList.contains('bk-toast-bump')).toBe(true);
  });

  it('forgets a toast once it is dismissed or closes itself, and still tells the caller', () => {
    const onDismiss = mock();
    const onAutoClose = mock();
    toast('Once', { onDismiss, onAutoClose });
    const first = calls[0] as Call;
    first.options.onDismiss?.({ id: first.options.id } as never);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    showToast(instanceOf(first));
    expect(toast('Once', { onAutoClose })).not.toBe(first.options.id as string);

    const second = calls[1] as Call;
    second.options.onAutoClose?.({ id: second.options.id } as never);
    expect(onAutoClose).toHaveBeenCalledTimes(1);
    second.options.onDismiss?.({ id: second.options.id } as never);
  });

  it('never dedupes a message that is not a string, so it cannot choke on one', () => {
    const node: Record<string, unknown> = { type: 'span' };
    node.self = node;
    expect(() => toast(node as unknown as React.ReactNode)).not.toThrow();
    expect(calls[0]?.options.id).toBeUndefined();
  });

  it('passes a caller id straight through', () => {
    expect(toast('Mine', { id: 'fixed' })).toBe('fixed');
    expect(calls[0]?.options).toEqual({ id: 'fixed' });
  });

  it('settles a loading toast with the result kind and keeps its id', async () => {
    const id = toast.loading('Saving');
    expect(typeof id).toBe('string');
    const { promise, data } = promised[0] as (typeof promised)[number];
    expect(data).toMatchObject({ id, loading: 'Saving' });

    expect(toast.info('Saved', { id })).toBe(id);
    expect(calls).toHaveLength(0);
    const settled = await promise;
    expect((data.success as (value: unknown) => unknown)(settled)).toEqual({
      message: 'Saved',
      type: 'info',
    });
  });

  it('fails a loading toast with an error or a warning', async () => {
    const id = toast.loading('Pushing', { id: 'push' });
    expect(id).toBe('push');
    toast.warning('Rejected', { id });
    const { promise, data } = promised[0] as (typeof promised)[number];
    const failure = await promise.then(
      () => null,
      (reason: unknown) => reason
    );
    expect((data.error as (value: unknown) => unknown)(failure)).toEqual({
      message: 'Rejected',
      type: 'warning',
    });
  });

  it('lets a dismissed loading toast be followed by a fresh toast with the same id', () => {
    const id = toast.loading('Deploying');
    toast.dismiss(id);
    expect(dismiss).toHaveBeenCalledWith(id);
    toast.success('Deployed', { id });
    expect(calls[0]).toMatchObject({ kind: 'success', options: { id } });

    const other = toast.loading('Again');
    toast.dismiss();
    toast.error('Failed', { id: other });
    expect(calls[1]).toMatchObject({ kind: 'error', options: { id: other } });
  });

  it('returns a plain id from a promise toast', () => {
    promiseHandle = Object.assign(new String('promise-id'), { unwrap: () => undefined });
    expect(toast.promise(Promise.resolve(1), { loading: 'Working' })).toBe('promise-id');
    promiseHandle = Object.assign(new Number(7), { unwrap: () => undefined });
    expect(toast.promise(Promise.resolve(1), { loading: 'Working' })).toBe(7);
    promiseHandle = { unwrap: () => undefined };
    expect(toast.promise(() => Promise.resolve(1), {})).toBeUndefined();
  });

  it('passes custom and message toasts through', () => {
    const jsx = () => <div />;
    expect(toast.custom(jsx)).toBe('custom-id');
    expect(toast.message('Hello')).toBe('message-id');
    expect(custom).toHaveBeenCalledWith(jsx, undefined);
  });
});

describe('Toaster', () => {
  it('renders sonner bottom right and cues a toast when its promise settles', async () => {
    const view = render(<Toaster />);
    expect(view.getByTestId('toaster').dataset.position).toBe('bottom-right');

    const element = showToast('bk-toast');
    element.setAttribute('data-type', 'loading');
    await act(async () => {
      await flush();
      element.setAttribute('data-type', 'success');
      await flush();
      expect(element.classList.contains('bk-toast-bump')).toBe(true);

      element.setAttribute('data-type', 'loading');
      await flush();
      element.setAttribute('data-type', 'error');
      await flush();
      expect(element.classList.contains('bk-toast-shake')).toBe(true);

      element.setAttribute('data-type', 'loading');
      await flush();
      element.setAttribute('data-type', 'custom');
      await flush();
      expect(element.classList.contains('bk-toast-bump')).toBe(true);

      const other = document.createElement('li');
      other.setAttribute('data-type', 'loading');
      document.body.append(other);
      await flush();
      other.setAttribute('data-type', 'success');
      element.setAttribute('data-type', 'error');
      await flush();
      expect(other.classList.length).toBe(0);
    });
  });
});
