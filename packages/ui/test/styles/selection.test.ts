import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/styles/globals.css', import.meta.url), 'utf8');

describe('the selection policy in globals.css', () => {
  it('makes the desktop app chrome: unselectable, under the arrow, nothing ghost-drags, while a browser keeps native selection', () => {
    expect(css).toContain(
      '  :where(html[data-desktop]) body {\n    -webkit-user-select: none;\n    user-select: none;\n    cursor: default;\n  }'
    );
    expect(css).toContain('  :where(html[data-desktop]) :where(a, img) {\n    -webkit-user-drag: none;\n  }');
    expect(css).not.toMatch(/^ {2}body \{\n {4}-webkit-user-select: none;/m);
  });

  it('lets content back in through the one selectable class, with the I-beam, except while dragging', () => {
    const start = css.indexOf('@utility selectable {');
    const utility = css.slice(start, css.indexOf('\n}', start));
    expect(utility).toContain('user-select: text;');
    expect(utility).toContain('cursor: text;');
    expect(utility).toContain(':where(body[data-dragging]) &');
  });
});
