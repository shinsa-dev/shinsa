import { describe, expect, it, mock } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useCodeKeyLabel, useCodeKeys } from '@/hooks/use-code-keys.ts';

function actions() {
  return {
    'quick-open': mock(() => {}),
    search: mock(() => {}),
    find: mock(() => {}),
    'goto-line': mock(() => {}),
  };
}

describe('useCodeKeys', () => {
  it('binds the Code tab’s keys while it is open, and nothing after', () => {
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const modifier = mac ? { metaKey: true } : { ctrlKey: true };
    const bound = actions();
    const { unmount } = renderHook(() => useCodeKeys(bound));
    const event = new KeyboardEvent('keydown', { key: 'p', cancelable: true, ...modifier });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', shiftKey: true, ...modifier }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', ...modifier }));
    expect(bound['quick-open']).toHaveBeenCalledTimes(1);
    expect(bound.search).toHaveBeenCalledTimes(1);
    unmount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ...modifier }));
    expect(bound['quick-open']).toHaveBeenCalledTimes(1);
    expect(typeof renderHook(() => useCodeKeyLabel()).result.current).toBe('boolean');
  });
});
