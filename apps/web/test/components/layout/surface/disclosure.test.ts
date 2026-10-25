import { describe, expect, it } from 'bun:test';
import {
  DISCLOSURE_CHEVRON_PX,
  DISCLOSURE_STRIP_PX,
  type DisclosureChevron,
  type DisclosureStrip,
  resolveDisclosureStrip,
  resolveTrailingInsetPx,
  TRAILING_INSET,
} from '@/components/layout/surface/disclosure.ts';

const STRIPS = Object.keys(DISCLOSURE_STRIP_PX) as DisclosureStrip[];

const CHEVRONS = Object.keys(DISCLOSURE_CHEVRON_PX) as DisclosureChevron[];

function spacingOf(classes: string, variable: string) {
  const match = classes.match(new RegExp(`\\[--${variable}:--spacing\\((\\d+(?:\\.\\d+)?)\\)\\]`));
  return Number(match?.[1]) * 4;
}

describe('a collapsible header’s trailing inset', () => {
  it('equals the vertical inset of its trailing chevron', () => {
    expect(resolveTrailingInsetPx('band', 'box')).toBe(7);
    expect(resolveTrailingInsetPx('strip', 'box')).toBe(3);
    expect(resolveTrailingInsetPx('block', 'glyph')).toBe(9);
    expect(resolveTrailingInsetPx('line', 'glyph')).toBe(5);
  });

  it('writes the same heights and chevron sizes into the classes it draws with', () => {
    for (const strip of STRIPS) {
      for (const chevron of CHEVRONS) {
        const classes = resolveDisclosureStrip(strip, chevron);
        expect(spacingOf(classes, 'strip-height')).toBe(DISCLOSURE_STRIP_PX[strip]);
        expect(spacingOf(classes, 'trailing-size')).toBe(DISCLOSURE_CHEVRON_PX[chevron]);
        expect(classes).toContain('h-(--strip-height)');
        expect(classes).toContain(TRAILING_INSET);
      }
    }
  });
});
