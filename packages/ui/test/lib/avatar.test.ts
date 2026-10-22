import { describe, expect, it } from 'bun:test';
import { resolveAvatarUrl, resolvePastelPair, resolvePastelStop } from '../../src/lib/avatar';

describe('resolvePastelPair', () => {
  it('is deterministic per seed', () => {
    expect(resolvePastelPair('Superwall')).toEqual(resolvePastelPair('Superwall'));
    expect(resolvePastelPair('ada', 'orb')).toEqual(resolvePastelPair('ada', 'orb'));
  });

  it('blends two different neighbouring ramps for a tile, one ramp for an orb', () => {
    const [from, to] = resolvePastelPair('Personal', 'tile');
    expect(from).not.toBe(to);
    const [hue, same] = resolvePastelPair('Personal', 'orb');
    expect(hue).toBe(same);
  });

  it('spreads seeds across the palette', () => {
    const tiles = new Set(
      Array.from({ length: 64 }, (_, index) => resolvePastelPair(`seed-${index}`).join('/'))
    );
    const orbs = new Set(
      Array.from({ length: 64 }, (_, index) => resolvePastelPair(`seed-${index}`, 'orb')[0])
    );
    expect(tiles.size).toBe(8);
    expect(orbs.size).toBe(8);
  });
});

describe('resolvePastelStop', () => {
  it('reads the raw ramp by day and lifts the accent toward white by night', () => {
    expect(resolvePastelStop('sky', 2)).toBe(
      'light-dark(var(--sky-2), color-mix(in oklab, var(--sky-4), white 45%))'
    );
    expect(resolvePastelStop('pink', 3)).toBe(
      'light-dark(var(--pink-3), color-mix(in oklab, var(--pink-4), white 25%))'
    );
  });
});

describe('resolveAvatarUrl', () => {
  it('slugs the name into a stable path', () => {
    expect(resolveAvatarUrl('Ada Lovelace!')).toStartWith('https://api.kodama.sh/Ada-Lovelace?');
    expect(resolveAvatarUrl('  -x.y_z- ')).toStartWith('https://api.kodama.sh/x.y_z?');
  });

  it('falls back to a shared face when nothing usable remains', () => {
    expect(resolveAvatarUrl('???')).toStartWith('https://api.kodama.sh/anonymous?');
  });
});
