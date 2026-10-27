import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/styles/globals.css', import.meta.url), 'utf8');

describe('the selection policy in globals.css', () => {
  it('makes the whole app chrome: unselectable, under the arrow, nothing ghost-drags', () => {
    expect(css).toContain(
      '  body {\n    -webkit-user-select: none;\n    user-select: none;\n    cursor: default;\n  }'
    );
    expect(css).toContain('  :where(a, img) {\n    -webkit-user-drag: none;\n  }');
  });

  it('lets content back in through the one selectable class, with the I-beam, except while dragging', () => {
    const start = css.indexOf('@utility selectable {');
    const utility = css.slice(start, css.indexOf('\n}', start));
    expect(utility).toContain('user-select: text;');
    expect(utility).toContain('cursor: text;');
    expect(utility).toContain(':where(body[data-dragging]) &');
  });
});
