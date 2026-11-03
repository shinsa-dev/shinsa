import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { EASE_EMPHASIZED } from '../../src/lib/motion';

const css = readFileSync(new URL('../../src/styles/globals.css', import.meta.url), 'utf8');

describe('the emphasized easing', () => {
  it('is the one curve the stylesheet token and the scripts both read', () => {
    expect(css).toContain(`@theme static {\n  --ease-emphasized: ${EASE_EMPHASIZED};\n}`);
    expect(css.split(EASE_EMPHASIZED)).toHaveLength(2);
  });
});
