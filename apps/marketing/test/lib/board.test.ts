import { describe, expect, it } from 'bun:test';
import { resolveBoard, resolveInsets, resolveSignal } from '../../src/lib/board.ts';

const PAGE_WIDTH = 1440;
const BOTH = { incoming: true, outgoing: true };

function chip(top: number, bottom: number) {
  return { left: 240, right: 1200, top, bottom };
}

function listPinYs(chips: ReturnType<typeof chip>[], index: number) {
  return resolveBoard(chips, PAGE_WIDTH)
    .pins.filter((pin) => pin.chip === index)
    .map((pin) => pin.y);
}

describe('resolveBoard', () => {
  it('keeps the full insets on a tall section', () => {
    expect(resolveInsets(chip(0, 800), 2, BOTH)).toEqual({ entry: 152, exit: 72 });
  });

  it('brings lines into a short section near its top and out near its bottom', () => {
    const ys = listPinYs([chip(0, 600), chip(800, 1020), chip(1300, 1900)], 1);
    expect(ys).toHaveLength(8);
    expect(Math.min(...ys)).toBe(824);
    expect(Math.max(...ys)).toBe(996);
  });

  it('centers the lines on a short last section', () => {
    const ys = listPinYs([chip(0, 600), chip(800, 940)], 1);
    expect(ys).toHaveLength(4);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(870);
  });

  it('centers the lines on a short first section', () => {
    expect(resolveInsets(chip(0, 140), 2, { incoming: false, outgoing: true })).toEqual({
      entry: 62,
      exit: 62,
    });
  });

  it('draws no lines beside a section that fills the page', () => {
    const wide = { left: 0, right: PAGE_WIDTH, top: 0, bottom: 800 };
    expect(resolveBoard([wide, { ...wide, top: 1000, bottom: 1800 }], PAGE_WIDTH).pins).toHaveLength(0);
  });

  it('adds pads beside narrow sections with room for stubs', () => {
    const chips = Array.from({ length: 8 }, (_, index) => ({
      left: 400,
      right: 1040,
      top: index * 1000,
      bottom: index * 1000 + 800,
    }));
    expect(resolveBoard(chips, PAGE_WIDTH).pads.length).toBeGreaterThan(0);
  });
});

describe('resolveSignal', () => {
  it('runs from 0 at the start of a bus to 1 at its end', () => {
    const bus = { d: '', from: 100, to: 300 };
    expect(resolveSignal(bus, 50)).toBe(0);
    expect(resolveSignal(bus, 200)).toBe(0.5);
    expect(resolveSignal(bus, 400)).toBe(1);
  });

  it('stays at 0 on a bus with no length', () => {
    expect(resolveSignal({ d: '', from: 300, to: 300 }, 300)).toBe(0);
  });
});
