import { describe, expect, it } from 'bun:test';
import { appendSample, isHeadingInto, SAMPLE_WINDOW_MS } from '../../src/lib/pointer-intent';

const box = { left: 100, right: 200, top: 100, bottom: 200 };

describe('appendSample', () => {
  it('keeps only the samples inside the window', () => {
    const samples = appendSample(
      [
        { x: 0, y: 0, t: 0 },
        { x: 1, y: 1, t: 50 },
      ],
      { x: 2, y: 2, t: SAMPLE_WINDOW_MS + 10 }
    );
    expect(samples).toEqual([
      { x: 1, y: 1, t: 50 },
      { x: 2, y: 2, t: SAMPLE_WINDOW_MS + 10 },
    ]);
  });
});

describe('isHeadingInto', () => {
  it('is false without samples', () => {
    expect(isHeadingInto([], box)).toBe(false);
  });

  it('is true while the pointer is inside the box, moving or not', () => {
    expect(isHeadingInto([{ x: 150, y: 150, t: 0 }], box)).toBe(true);
  });

  it('is false when the pointer has barely moved outside the box', () => {
    expect(
      isHeadingInto(
        [
          { x: 0, y: 150, t: 0 },
          { x: 2, y: 150, t: 10 },
        ],
        box
      )
    ).toBe(false);
  });

  it('is true when the path points into the box', () => {
    expect(
      isHeadingInto(
        [
          { x: 0, y: 140, t: 0 },
          { x: 20, y: 145, t: 10 },
        ],
        box
      )
    ).toBe(true);
    expect(
      isHeadingInto(
        [
          { x: 150, y: 0, t: 0 },
          { x: 150, y: 30, t: 10 },
        ],
        box
      )
    ).toBe(true);
  });

  it('is false when the path points away or passes beside it', () => {
    expect(
      isHeadingInto(
        [
          { x: 20, y: 150, t: 0 },
          { x: 0, y: 150, t: 10 },
        ],
        box
      )
    ).toBe(false);
    expect(
      isHeadingInto(
        [
          { x: 0, y: 0, t: 0 },
          { x: 0, y: 30, t: 10 },
        ],
        box
      )
    ).toBe(false);
    expect(
      isHeadingInto(
        [
          { x: 0, y: 300, t: 0 },
          { x: 20, y: 295, t: 10 },
        ],
        box
      )
    ).toBe(false);
  });
});
