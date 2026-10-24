import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useCodeLocation } from '@/hooks/use-code-location.ts';
import { navigate } from '@/router.ts';

describe('useCodeLocation', () => {
  it('reads the workbench from the URL and writes changes back, so reload and Back restore it', () => {
    navigate('/tasks/t1?tab=code&mode=files&file=src%2Fa.ts&line=4');
    const { result } = renderHook(() => useCodeLocation(['review', 'changes', 'files']));
    expect(result.current.location).toMatchObject({
      mode: 'files',
      active: { kind: 'file', path: 'src/a.ts' },
      line: 4,
    });
    act(() => result.current.apply({ line: '9' }));
    expect(result.current.location.line).toBe(9);
    act(() => history.back());
    act(() => dispatchEvent(new PopStateEvent('popstate')));
    act(() => result.current.apply({ mode: null }, { replace: true }));
    expect(result.current.location.mode).toBe('review');
  });
});
