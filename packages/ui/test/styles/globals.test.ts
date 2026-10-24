import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

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
});
