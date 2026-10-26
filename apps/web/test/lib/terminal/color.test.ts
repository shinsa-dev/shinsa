import { describe, expect, it } from 'bun:test';
import { convertOklch, resolveCssColor } from '@/lib/terminal/color.ts';

describe('resolveCssColor', () => {
  it('reads hex in its three lengths', () => {
    expect(resolveCssColor('#FFF')).toBe('#ffffff');
    expect(resolveCssColor(' #1e1e2e ')).toBe('#1e1e2e');
    expect(resolveCssColor('#1e1e2e80')).toBe('#1e1e2e80');
    expect(resolveCssColor('#12')).toBeNull();
  });

  it('turns the design tokens’ oklch into sRGB hex, with alpha when it has one', () => {
    expect(resolveCssColor('oklch(1 0 0)')).toBe('#ffffff');
    expect(resolveCssColor('oklch(0.21 0.008 274.53)')).toBe('#17181c');
    expect(resolveCssColor('oklch(0 0 0)')).toBe('#000000');
    expect(resolveCssColor('oklch(0.6 0.215 256)')).toBe('#007bfc');
    expect(resolveCssColor('oklch(60% 0.215 256 / 0.5)')).toBe('#007bfc80');
    expect(resolveCssColor('oklch(0.6 50% 256 / 25%)')).toBe('#0c7cf440');
  });

  it('reads rgb and rgba, comma or space separated', () => {
    expect(resolveCssColor('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(resolveCssColor('rgba(0 128 255 / 0.5)')).toBe('#0080ff80');
    expect(resolveCssColor('rgb(100%, 0%, 0%)')).toBe('#ff0000');
  });

  it('gives up on anything else', () => {
    expect(resolveCssColor('')).toBeNull();
    expect(resolveCssColor('var(--fg-4)')).toBeNull();
    expect(resolveCssColor('color-mix(in oklch, red, blue)')).toBeNull();
    expect(resolveCssColor('oklch(abc 0 0)')).toBeNull();
  });
});

describe('convertOklch', () => {
  it('clips colours outside sRGB when they are written as hex', () => {
    const [red, green, blue] = convertOklch(0.9, 0.4, 140);
    expect(red).toBeLessThan(0);
    expect(green).toBeGreaterThan(1);
    expect(blue).toBeLessThan(0);
    expect(resolveCssColor('oklch(0.9 0.4 140)')).toBe('#00ff00');
  });
});
