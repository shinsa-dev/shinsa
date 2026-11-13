import { describe, expect, it } from 'bun:test';
import { resolveBoard, resolveInsets } from '../../src/lib/board.ts';

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
});
