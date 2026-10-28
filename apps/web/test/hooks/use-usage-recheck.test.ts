import { describe, expect, it, mock, spyOn } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useUsageRecheck } from '@/hooks/use-usage-recheck.ts';
import * as accounts from '@/lib/connection/accounts.ts';

describe('useUsageRecheck', () => {
  it('watches usage only while it is active, and lets go when it turns off or unmounts', () => {
    const stop = mock(() => undefined);
    const watch = spyOn(accounts, 'watchUsage').mockReturnValue(stop);
    try {
      const { rerender, unmount } = renderHook(({ active }) => useUsageRecheck(active), {
        initialProps: { active: false },
      });
      expect(watch).not.toHaveBeenCalled();
      rerender({ active: true });
      expect(watch).toHaveBeenCalledTimes(1);
      rerender({ active: false });
      expect(stop).toHaveBeenCalledTimes(1);
      rerender({ active: true });
      unmount();
      expect(stop).toHaveBeenCalledTimes(2);
    } finally {
      watch.mockRestore();
    }
  });
});
