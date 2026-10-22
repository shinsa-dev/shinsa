import { afterEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { useMediaQuery } from '../../src/hooks/use-media-query';
import { MOBILE_BREAKPOINT, useIsMobile } from '../../src/hooks/use-mobile';
import { installMedia } from '../support/media';

let media: ReturnType<typeof installMedia>;

afterEach(() => media.restore());

describe('useMediaQuery', () => {
  it('reads the current answer and follows changes', () => {
    media = installMedia({ '(hover: hover)': true });
    const { result } = renderHook(() => useMediaQuery('(hover: hover)'));
    expect(result.current).toBe(true);

    act(() => media.flip('(hover: hover)', false));
    expect(result.current).toBe(false);
  });

  it('stops listening once unmounted', () => {
    media = installMedia();
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1px)'));
    expect(media.listenerCount('(min-width: 1px)')).toBe(1);
    unmount();
    expect(media.listenerCount('(min-width: 1px)')).toBe(0);
  });

  it('answers with the fallback when rendered on a server', () => {
    media = installMedia({ '(hover: hover)': false });
    function Probe() {
      return <span>{String(useMediaQuery('(hover: hover)', true))}</span>;
    }
    expect(renderToString(<Probe />)).toBe('<span>true</span>');
  });
});

describe('useIsMobile', () => {
  it('is true below the breakpoint', () => {
    const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;
    media = installMedia({ [query]: false });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => media.flip(query, true));
    expect(result.current).toBe(true);
  });
});
