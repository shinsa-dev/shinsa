import { describe, expect, it } from 'bun:test';
import { iconSwap, iconSwapIn, iconSwapMotion, iconSwapOut } from '../../src/lib/icon-swap';

describe('icon swap', () => {
  it('transitions exactly the properties the two states change', () => {
    expect(iconSwap).toContain('transition-[opacity,scale,filter]');
    expect(iconSwapIn.split(' ')).toEqual(['scale-100', 'opacity-100', 'blur-none']);
    expect(iconSwapOut.split(' ')).toEqual(['scale-[0.65]', 'opacity-0', 'blur-[2px]']);
  });

  it('is symmetric: an icon leaves the way the next one arrives', () => {
    expect(iconSwapMotion.exit).toEqual(iconSwapMotion.initial);
    expect(iconSwapMotion.initial.scale).toBe(0.65);
    expect(iconSwapMotion.animate).toEqual({ opacity: 1, scale: 1, filter: 'blur(0px)' });
  });
});
