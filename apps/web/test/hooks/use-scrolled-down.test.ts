import { describe, expect, it } from 'bun:test';
import { isScrolledDown } from '@/hooks/use-scrolled-down.ts';

describe('isScrolledDown', () => {
  it('turns on once the list is scrolled past one viewport', () => {
    expect(isScrolledDown({ scrollTop: 0, clientHeight: 600 })).toBe(false);
    expect(isScrolledDown({ scrollTop: 600, clientHeight: 600 })).toBe(false);
    expect(isScrolledDown({ scrollTop: 601, clientHeight: 600 })).toBe(true);
  });

  it('stays off while the list has no height yet', () => {
    expect(isScrolledDown({ scrollTop: 10, clientHeight: 0 })).toBe(false);
  });
});
