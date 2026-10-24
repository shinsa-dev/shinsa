import { describe, expect, it } from 'bun:test';
import { iconSwap, iconSwapIn, iconSwapOut } from '../../src/lib/icon-swap';

const PROPERTY = { scale: 'scale', opacity: 'opacity', blur: 'filter' } as const;

function listChangedProperties(state: string): string[] {
  return state.split(' ').map((token) => PROPERTY[token.split('-')[0] as keyof typeof PROPERTY]);
}

describe('icon swap', () => {
  it('lands the incoming icon a step under its text, like any icon, and hides the outgoing one', () => {
    expect(iconSwapIn.split(' ')).toContain('opacity-(--icon-alpha)');
    expect(iconSwapOut.split(' ')).toContain('opacity-0');
  });

  it('animates every property the two states change, so neither end jumps', () => {
    const animated = /transition-\[([^\]]+)\]/.exec(iconSwap)?.[1]?.split(',');
    expect(listChangedProperties(iconSwapIn).sort()).toEqual([...(animated ?? [])].sort());
    expect(listChangedProperties(iconSwapOut).sort()).toEqual([...(animated ?? [])].sort());
  });
});
