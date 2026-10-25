import { describe, expect, it } from 'bun:test';
import {
  resolveDragScrollTop,
  resolveFadeTimelines,
  resolveOverflowEdges,
  resolveThumb,
  resolveTrackScrollTop,
  THUMB_EDGE,
  THUMB_MIN_SIZE,
} from '../../src/lib/scroll';

const metrics = (scrollTop: number, scrollHeight = 1000, clientHeight = 208) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

describe('resolveOverflowEdges', () => {
  it('has no hidden content when everything fits', () => {
    expect(resolveOverflowEdges(0, 200, 200)).toEqual({ start: false, end: false });
  });

  it('hides content past the end at the top, and before the start once scrolled', () => {
    expect(resolveOverflowEdges(0, 200, 500)).toEqual({ start: false, end: true });
    expect(resolveOverflowEdges(150, 200, 500)).toEqual({ start: true, end: true });
    expect(resolveOverflowEdges(300, 200, 500)).toEqual({ start: true, end: false });
  });

  it('treats a fractional resting position at the end as the end', () => {
    expect(resolveOverflowEdges(299.4, 200, 500)).toEqual({ start: true, end: false });
  });
});

describe('resolveFadeTimelines', () => {
  it('names a timeline per axis from a React id, keeping only characters a name may hold', () => {
    expect(resolveFadeTimelines('«r1»')).toEqual({
      '--fade-timeline-y': '--fade-yr1',
      '--fade-timeline-x': '--fade-xr1',
    });
    expect(resolveFadeTimelines('_r_2_')['--fade-timeline-y']).toBe('--fade-y_r_2_');
  });
});

describe('resolveThumb', () => {
  it('is null when there is nothing to scroll, or a pixel at most', () => {
    expect(resolveThumb(metrics(0, 208))).toBeNull();
    expect(resolveThumb(metrics(0, 209))).toBeNull();
  });

  it('sizes the thumb to the visible share of the track inside its edges', () => {
    const thumb = resolveThumb(metrics(0, 400, 208));
    const room = 208 - THUMB_EDGE * 2;
    expect(thumb).toEqual({
      size: (208 / 400) * room,
      offset: 0,
      travel: room - (208 / 400) * room,
      scrollable: 192,
    });
  });

  it('never draws the thumb shorter than the minimum', () => {
    expect(resolveThumb(metrics(0, 100_000))?.size).toBe(THUMB_MIN_SIZE);
  });

  it('moves the thumb in proportion and keeps it on the track when the page overscrolls', () => {
    const thumb = resolveThumb(metrics(396))!;
    expect(thumb.offset).toBeCloseTo(thumb.travel / 2);
    expect(resolveThumb(metrics(-40))?.offset).toBe(0);
    expect(resolveThumb(metrics(2000))?.offset).toBe(thumb.travel);
  });
});

describe('resolveDragScrollTop', () => {
  it('maps thumb pixels onto content pixels', () => {
    const thumb = resolveThumb(metrics(0))!;
    expect(resolveDragScrollTop(metrics(0), 100, 10)).toBeCloseTo(
      100 + (10 * thumb.scrollable) / thumb.travel
    );
  });

  it('leaves the position alone when nothing scrolls', () => {
    expect(resolveDragScrollTop(metrics(0, 100), 0, 50)).toBe(0);
  });

  it('never divides by a zero-length track', () => {
    expect(resolveDragScrollTop(metrics(0, 300, 20), 0, 5)).toBe(5 * 280);
  });
});

describe('resolveTrackScrollTop', () => {
  it('centres the thumb on the pointer', () => {
    const thumb = resolveThumb(metrics(0))!;
    const pointer = THUMB_EDGE + thumb.size / 2 + thumb.travel / 2;
    expect(resolveTrackScrollTop(metrics(0), pointer)).toBeCloseTo(thumb.scrollable / 2);
  });

  it('clamps presses beyond either end of the travel', () => {
    expect(resolveTrackScrollTop(metrics(300), 0)).toBe(0);
    expect(resolveTrackScrollTop(metrics(0), 10_000)).toBe(1000 - 208);
  });

  it('keeps the position when nothing scrolls, and goes to the top when the thumb fills the track', () => {
    expect(resolveTrackScrollTop(metrics(0, 100), 50)).toBe(0);
    expect(resolveTrackScrollTop(metrics(4, 300, 20), 10)).toBe(0);
  });
});
