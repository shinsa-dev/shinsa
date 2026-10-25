import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { FILE_TINTS, TONED_ICON_SOURCES } from '../../src/components/icon/custom';

const css = readFileSync(new URL('../../src/styles/globals.css', import.meta.url), 'utf8');

function readBlock(selector: string) {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
}

function readLightness(block: string, token: string) {
  const match = new RegExp(`--${token}: oklch\\(([\\d.]+) `).exec(block);
  return Number(match?.[1]);
}

const THEMES = [
  { name: 'light', block: readBlock(':root'), quieter: (icon: number, text: number) => icon > text },
  { name: 'dark', block: readBlock('.dark'), quieter: (icon: number, text: number) => icon < text },
];

describe('globals.css', () => {
  for (const theme of THEMES) {
    it(`draws every ${theme.name} icon ink a step quieter than its text, never brighter`, () => {
      for (const step of [1, 2, 3, 4]) {
        const icon = readLightness(theme.block, `icon-${step}`);
        const text = readLightness(theme.block, `fg-${step}`);
        expect(Number.isNaN(icon)).toBe(false);
        expect(theme.quieter(icon, text)).toBe(true);
      }
    });
  }

  it('pairs every grey text step with its icon ink and draws icons in it', () => {
    for (const step of [1, 2, 3, 4]) expect(css).toContain(`--icon-ink-fg-${step}: var(--icon-${step});`);
    expect(css).toContain('--icon-color: --value(--icon-ink-*, --color-*);');
    expect(css).toContain('color: var(--icon-color, currentColor);');
  });

  it('has three icon sizes and no icon opacity', () => {
    expect(css.match(/--icon-size-(?:sm|md|lg): /g)).toHaveLength(3);
    expect(css).not.toContain('--icon-alpha');
    expect(readBlock('[data-sonner-toast][data-styled="true"].bk-toast [data-icon] > svg')).not.toContain(
      'opacity'
    );
  });

  it('drives the scroll fades from scroll timelines, so style alone sets them on the first frame', () => {
    const fade = css.slice(css.indexOf('@utility scroll-fade {'), css.indexOf('@keyframes scroll-fade-t'));
    expect(fade).toContain('@supports (animation-timeline: scroll())');
    expect(fade).toContain('animation-timeline: var(--fade-timeline-y), var(--fade-timeline-y);');
    expect(fade).toContain('&[data-fade-orientation="horizontal"]');
    expect(fade).toContain('&[data-fade-orientation="both"]');
    expect(fade).toContain('transition: none;');
    for (const edge of ['t', 'b', 'l', 'r']) expect(css).toContain(`@keyframes scroll-fade-${edge} {`);
  });

  it('reads its own named timelines, or, on a still wrapper, the scroller it scopes', () => {
    const fade = css.slice(css.indexOf('@utility scroll-fade {'), css.indexOf('@keyframes scroll-fade-t'));
    expect(fade).toContain(
      '&[data-fade-scope] {\n      scroll-timeline: none;\n      timeline-scope: var(--fade-timeline-y), var(--fade-timeline-x);'
    );
    expect(fade).toContain('@utility scroll-fade-source {');
    expect(fade.match(/var\(--fade-timeline-y\) block,\n\s+var\(--fade-timeline-x\) inline;/g)).toHaveLength(
      2
    );
    expect(fade).not.toContain('scroll(self');
  });

  it('sets every file tint in both themes and lets a row mute its marks', () => {
    for (const block of [readBlock(':root'), readBlock('.dark')]) {
      for (const tint of FILE_TINTS) expect(block).toContain(`--file-${tint}: oklch(`);
    }
    for (const { tone } of Object.values(TONED_ICON_SOURCES)) expect(FILE_TINTS).toContain(tone);
    expect(css).toContain('@utility file-icons-muted {\n  --file-icon-ink: currentColor;');
  });
});
