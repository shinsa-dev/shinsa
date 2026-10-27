import { describe, expect, it } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useSelectAllScope } from '../../src/hooks/use-select-all-scope';

function pressSelectAll() {
  const event = new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('useSelectAllScope', () => {
  it('scopes ⌘A while mounted and lets go when unmounted', () => {
    const { unmount } = renderHook(() => useSelectAllScope());
    expect(pressSelectAll()).toBe(true);
    unmount();
    expect(pressSelectAll()).toBe(false);
  });
});
