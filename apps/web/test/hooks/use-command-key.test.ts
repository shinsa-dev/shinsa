import { afterEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useCommandHotkey, useCommandKey } from '@/hooks/use-command-key.ts';
import { useCommandMenuOpen, writeCommandMenuOpen } from '@/lib/command/registry.ts';

afterEach(() => {
  writeCommandMenuOpen(false);
});

function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('useCommandHotkey', () => {
  it('toggles the command menu with ⌘K and Ctrl K', () => {
    renderHook(() => useCommandHotkey());
    const menu = renderHook(() => useCommandMenuOpen());
    const event = press({ key: 'k', metaKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(menu.result.current).toBe(true);
    press({ key: 'K', ctrlKey: true });
    expect(menu.result.current).toBe(false);
  });

  it('leaves other keys and modifier combinations alone', () => {
    renderHook(() => useCommandHotkey());
    const menu = renderHook(() => useCommandMenuOpen());
    const plain = press({ key: 'k' });
    press({ key: 'k', metaKey: true, shiftKey: true });
    press({ key: 'k', ctrlKey: true, altKey: true });
    press({ key: 'j', metaKey: true });
    expect(plain.defaultPrevented).toBe(false);
    expect(menu.result.current).toBe(false);
  });

  it('stops listening after unmount', () => {
    const { unmount } = renderHook(() => useCommandHotkey());
    unmount();
    const menu = renderHook(() => useCommandMenuOpen());
    press({ key: 'k', metaKey: true });
    expect(menu.result.current).toBe(false);
  });
});

describe('useCommandKey', () => {
  it('shows ⌘ on Apple devices and Ctrl elsewhere', () => {
    const shown = (platform: string) => {
      Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
      return renderHook(() => useCommandKey()).result.current;
    };
    expect(shown('MacIntel')).toBe('⌘');
    expect(shown('iPhone')).toBe('⌘');
    expect(shown('Win32')).toBe('Ctrl');
    Reflect.deleteProperty(navigator, 'platform');
  });
});
