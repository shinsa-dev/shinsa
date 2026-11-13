import { describe, expect, it } from 'bun:test';
import { resolveBoard, resolveInsets } from '../../src/lib/board.ts';

const PAGE_WIDTH = 1440;

function chip(top: number, bottom: number) {
  return { left: 240, right: 1200, top, bottom };
}

function listPins(chips: ReturnType<typeof chip>[]) {
  return resolveBoard(chips, PAGE_WIDTH).pins;
}

describe('resolveBoard', () => {
  it('keeps the full insets on a tall section', () => {
    expect(resolveInsets(chip(0, 800), 2)).toEqual({ entry: 152, exit: 72 });
  });

  it('starts every outgoing line below every incoming one on a short section', () => {
    const short = chip(800, 1020);
    const incoming = listPins([chip(0, 600), short])
      .filter((pin) => pin.chip === 1)
      .map((pin) => pin.y);
    const outgoing = listPins([short, chip(1300, 1900)])
      .filter((pin) => pin.chip === 0)
      .map((pin) => pin.y);
    expect(incoming).toHaveLength(4);
    expect(outgoing).toHaveLength(4);
    expect(Math.min(...outgoing)).toBeGreaterThan(Math.max(...incoming));
  });

  it('scales the insets down in proportion on a short section', () => {
    const insets = resolveInsets(chip(0, 144), 2);
    expect(insets.entry).toBeCloseTo(76);
    expect(insets.exit).toBeCloseTo(36);
  });
});
