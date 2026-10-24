import { describe, expect, it } from 'bun:test';
import { resolveBadgeText } from '../../src/lib/badge.ts';

describe('resolveBadgeText', () => {
  it('shows how many decisions need you', () => {
    expect(resolveBadgeText(3)).toBe('3');
    expect(resolveBadgeText(120)).toBe('120');
  });

  it('clears the badge when nothing needs you or the count is not a count', () => {
    expect(resolveBadgeText(0)).toBe('');
    expect(resolveBadgeText(-1)).toBe('');
    expect(resolveBadgeText(1.5)).toBe('');
    expect(resolveBadgeText(Number.NaN)).toBe('');
    expect(resolveBadgeText('3')).toBe('');
    expect(resolveBadgeText(null)).toBe('');
  });
});
