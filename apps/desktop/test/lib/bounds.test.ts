import { describe, expect, it } from 'bun:test';
import { resolveWindowBounds } from '../../src/lib/bounds.ts';

const LAPTOP = { x: 0, y: 25, width: 1512, height: 920 };

const EXTERNAL = { x: 1512, y: 0, width: 2560, height: 1415 };

describe('resolveWindowBounds', () => {
  it('restores where the window was while that place is on a connected display', () => {
    const saved = { x: 1700, y: 100, width: 900, height: 1100 };
    expect(resolveWindowBounds(saved, [LAPTOP, EXTERNAL], LAPTOP)).toEqual(saved);
  });

  it('opens centred on the main display when the saved place is gone or too small', () => {
    const centred = { x: 306, y: 25, width: 900, height: 920 };
    expect(resolveWindowBounds({ x: 1700, y: 100, width: 900, height: 1100 }, [LAPTOP], LAPTOP)).toEqual(
      centred
    );
    expect(resolveWindowBounds({ x: 10, y: 30, width: 200, height: 1100 }, [LAPTOP], LAPTOP)).toEqual(
      centred
    );
    expect(resolveWindowBounds(undefined, [LAPTOP], LAPTOP)).toEqual(centred);
    expect(resolveWindowBounds({ x: 'a', y: 0, width: 900, height: 900 }, [LAPTOP], LAPTOP)).toEqual(centred);
  });

  it('opens at the default size where it fits', () => {
    expect(resolveWindowBounds(null, [EXTERNAL], EXTERNAL)).toEqual({
      x: 2342,
      y: 158,
      width: 900,
      height: 1100,
    });
  });
});
