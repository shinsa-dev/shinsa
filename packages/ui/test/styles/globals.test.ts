import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/styles/globals.css', import.meta.url), 'utf8');

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('globals.css', () => {
  it('draws a toast’s icon a step under its text, like every other icon', () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    document.body.innerHTML =
      '<section data-sonner-toaster><ol><li data-sonner-toast data-styled="true" class="bk-toast"><div data-icon><svg></svg></div></li></ol></section>';

    const icon = document.querySelector('[data-icon] > svg') as SVGElement;
    expect(getComputedStyle(icon).opacity).toBe('0.85');
  });
});
