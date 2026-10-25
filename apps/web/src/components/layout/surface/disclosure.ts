export type DisclosureStrip = 'line' | 'strip' | 'block' | 'band';

export type DisclosureChevron = 'glyph' | 'box';

export const DISCLOSURE_STRIP_PX: Record<DisclosureStrip, number> = {
  line: 24,
  strip: 28,
  block: 32,
  band: 36,
};

export const DISCLOSURE_CHEVRON_PX: Record<DisclosureChevron, number> = { glyph: 14, box: 22 };

const STRIP_HEIGHT: Record<DisclosureStrip, string> = {
  line: '[--strip-height:--spacing(6)]',
  strip: '[--strip-height:--spacing(7)]',
  block: '[--strip-height:--spacing(8)]',
  band: '[--strip-height:--spacing(9)]',
};

const TRAILING_SIZE: Record<DisclosureChevron, string> = {
  glyph: '[--trailing-size:--spacing(3.5)]',
  box: '[--trailing-size:--spacing(5.5)]',
};

export const TRAILING_INSET = 'pe-[calc((var(--strip-height)-var(--trailing-size))/2)]';

export const TRAILING_BOX = 'size-(--trailing-size)';

export function resolveDisclosureStrip(strip: DisclosureStrip, chevron: DisclosureChevron) {
  return `${STRIP_HEIGHT[strip]} ${TRAILING_SIZE[chevron]} h-(--strip-height) ${TRAILING_INSET}`;
}

export function resolveTrailingInsetPx(strip: DisclosureStrip, chevron: DisclosureChevron) {
  return (DISCLOSURE_STRIP_PX[strip] - DISCLOSURE_CHEVRON_PX[chevron]) / 2;
}
