import { afterEach, describe, expect, it, mock } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useTerminalKeys } from '@/hooks/use-terminal-keys.ts';

const PLATFORM = navigator.platform;

function setPlatform(value: string) {
  Object.defineProperty(navigator, 'platform', { configurable: true, get: () => value });
}

afterEach(() => setPlatform(PLATFORM));

describe('useTerminalKeys', () => {
  it('opens a tab with ⌘T and closes one with ⌘W on a Mac while the page is open, and nothing after', () => {
    setPlatform('MacIntel');
    const actions = { new: mock(() => {}), close: mock(() => {}) };
    const { unmount } = renderHook(() => useTerminalKeys(actions));
    const open = new KeyboardEvent('keydown', { key: 't', metaKey: true, cancelable: true });
    window.dispatchEvent(open);
    expect(open.defaultPrevented).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    expect([actions.new.mock.calls.length, actions.close.mock.calls.length]).toEqual([1, 1]);
    unmount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true }));
    expect(actions.new).toHaveBeenCalledTimes(1);
  });
});
