import { beforeEach, describe, expect, it, jest } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  createReviewSelection,
  SPOTLIGHT_HOLD_MS,
  useCurrentStop,
  useReviewSelection,
  useSelectionRequest,
  useStopLit,
} from '@/lib/review/selection.ts';

beforeEach(() => {
  jest.useFakeTimers();
});

describe('the Review tab’s selection', () => {
  it('starts on the place the link names, lit until the first light lets it go', () => {
    const selection = createReviewSelection('flow');
    expect(selection.readCurrent()).toBe('flow');
    expect(selection.readLit()).toBe('flow');
    expect(selection.readRequest()).toBe(0);
    expect(selection.holding).toBe(false);
  });

  it('tells its listeners only when something changed', () => {
    const selection = createReviewSelection(null);
    const heard = jest.fn();
    const stop = selection.subscribe(heard);
    selection.writeCurrent(null);
    selection.light(null);
    expect(heard).not.toHaveBeenCalled();
    selection.writeCurrent('a');
    selection.light('a');
    selection.request();
    expect(heard).toHaveBeenCalledTimes(3);
    stop();
    selection.writeCurrent('b');
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it('lights a place for a moment, starts the moment again on the next light, and stops on dispose', () => {
    const selection = createReviewSelection(null);
    selection.light('a');
    jest.advanceTimersByTime(SPOTLIGHT_HOLD_MS - 1);
    selection.light('b');
    jest.advanceTimersByTime(SPOTLIGHT_HOLD_MS - 1);
    expect(selection.readLit()).toBe('b');
    jest.advanceTimersByTime(1);
    expect(selection.readLit()).toBeNull();
    selection.light('c');
    selection.dispose();
    jest.advanceTimersByTime(SPOTLIGHT_HOLD_MS);
    expect(selection.readLit()).toBe('c');
  });

  it('renders a reader again only when the part it reads changes', () => {
    const { result } = renderHook(() => useReviewSelection('a'));
    const selection = result.current;
    let renders = 0;
    const lit = renderHook(() => {
      renders += 1;
      return useStopLit(selection, 'b');
    });
    const current = renderHook(() => useCurrentStop(selection));
    const request = renderHook(() => useSelectionRequest(selection));
    expect(lit.result.current).toBe(false);
    act(() => selection.writeCurrent('c'));
    act(() => selection.light('c'));
    expect(current.result.current).toBe('c');
    expect(renders).toBe(1);
    act(() => selection.light('b'));
    expect(lit.result.current).toBe(true);
    act(() => selection.request());
    expect(request.result.current).toBe(1);
    act(() => {
      jest.advanceTimersByTime(SPOTLIGHT_HOLD_MS);
    });
    expect(lit.result.current).toBe(false);
  });
});
