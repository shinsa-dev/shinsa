import { describe, expect, test } from 'bun:test';
import {
  escapeSlackText,
  fitSlackPlainText,
  fitSlackText,
  listSlackChunks,
  serializeSlackMrkdwn,
} from '../../src/index.ts';

describe('Markdown as Slack mrkdwn', () => {
  test('bold, italics, strikethrough and headings use Slack marks', () => {
    expect(serializeSlackMrkdwn('**Bold**, __also__, *soft*, _kept_ and ~~gone~~')).toBe(
      '*Bold*, *also*, _soft_, _kept_ and ~gone~'
    );
    expect(serializeSlackMrkdwn('## The **cause**')).toBe('*The cause*');
  });

  test('links become Slack links, images their link, and other schemes only their label', () => {
    expect(serializeSlackMrkdwn('See [the PR](https://github.com/a/b/pull/1?x=1&y=2).')).toBe(
      'See <https://github.com/a/b/pull/1?x=1&y=2|the PR>.'
    );
    expect(serializeSlackMrkdwn('![shot](https://cdn.dev/a.png)')).toBe('<https://cdn.dev/a.png|shot>');
    expect(serializeSlackMrkdwn('[session.ts](shinsa://file/src/session.ts#L1)')).toBe('session.ts');
    expect(serializeSlackMrkdwn('[](https://a.dev/x)')).toBe('<https://a.dev/x|https://a.dev/x>');
    expect(serializeSlackMrkdwn('[a|b](https://a.dev/x|y)')).toBe('<https://a.dev/x%7Cy|a/b>');
  });

  test('escapes &, < and > outside links, and keeps inline code as it is', () => {
    expect(serializeSlackMrkdwn('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d');
    expect(serializeSlackMrkdwn('Run `a **b** <c>` now')).toBe('Run `a **b** &lt;c&gt;` now');
  });

  test('lists become bullets, nested ones indented, task boxes ticked or not', () => {
    expect(serializeSlackMrkdwn('- one\n  - two\n* three\n- [ ] todo\n- [x] done\n1. kept')).toBe(
      '• one\n    ◦ two\n• three\n• ☐ todo\n• ☑ done\n1. kept'
    );
  });

  test('quotes stay quotes, rules go and blank runs collapse', () => {
    expect(serializeSlackMrkdwn('> said **this**\n\n---\n\n\n\nnext')).toBe('> said *this*\n\nnext');
  });

  test('code fences stay fenced with their text escaped, and an open fence is closed', () => {
    expect(serializeSlackMrkdwn('```ts\nif (a < b) **x**\n```')).toBe('```\nif (a &lt; b) **x**\n```');
    expect(serializeSlackMrkdwn('```\nopen')).toBe('```\nopen\n```');
  });

  test('a table becomes a code block without its divider row', () => {
    expect(serializeSlackMrkdwn('Before\n| A | B |\n| --- | :-: |\n| 1 | 2 |\nAfter')).toBe(
      'Before\n```\n| A | B |\n| 1 | 2 |\n```\nAfter'
    );
    expect(serializeSlackMrkdwn('| A |\n```\nx\n```')).toBe('```\n| A |\n```\n```\nx\n```');
  });
});

describe('fitting Slack limits', () => {
  test('text under the limit is kept whole', () => {
    expect(fitSlackText('short', 10)).toBe('short');
  });

  test('a cut ends at a word with an ellipsis', () => {
    const text = 'alpha beta gamma delta epsilon zeta';
    const fitted = fitSlackText(text, 20);
    expect(fitted.length).toBeLessThanOrEqual(20);
    expect(fitted).toBe('alpha beta…');
  });

  test('a cut never splits a link or an escape, and closes an open fence', () => {
    const link = fitSlackText(`see the logs <https://a.dev/${'x'.repeat(40)}|logs>`, 30);
    expect(link).toBe('see the logs…');
    expect(fitSlackText(`a${'b'.repeat(30)}&amp;`, 30)).not.toContain('&am');
    const fenced = fitSlackText(`\`\`\`\n${'line one\n'.repeat(10)}`, 40);
    expect(fenced.endsWith('```')).toBe(true);
    expect(fenced.length).toBeLessThanOrEqual(40);
  });

  test('plain text is flattened to one line and cut with an ellipsis', () => {
    expect(fitSlackPlainText('one\n two  three', 50)).toBe('one two three');
    expect(fitSlackPlainText('a'.repeat(20), 10)).toBe(`${'a'.repeat(9)}…`);
  });

  test('escaping covers the three characters Slack reads as markup', () => {
    expect(escapeSlackText('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });
});

describe('splitting long text into sections', () => {
  test('text that fits is one chunk', () => {
    expect(listSlackChunks('short', 100, 1000)).toEqual({ chunks: ['short'], cut: false });
  });

  test('splits at paragraph breaks and keeps every chunk within the size', () => {
    const paragraph = `${'word '.repeat(30).trim()}`;
    const text = Array.from({ length: 6 }, () => paragraph).join('\n\n');
    const { chunks, cut } = listSlackChunks(text, 400, 10_000);
    expect(cut).toBe(false);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(400);
    expect(chunks.join('\n\n')).toBe(text);
  });

  test('a fence split across chunks is closed in one and opened again in the next', () => {
    const text = `\`\`\`\n${Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')}\n\`\`\``;
    const { chunks } = listSlackChunks(text, 120, 10_000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('```')).toBe(true);
      expect((chunk.match(/```/g) ?? []).length % 2).toBe(0);
      expect(chunk.length).toBeLessThanOrEqual(120);
    }
  });

  test('stops at the total and says it was cut', () => {
    const text = Array.from({ length: 50 }, (_, index) => `paragraph ${index}`).join('\n\n');
    const { chunks, cut } = listSlackChunks(text, 100, 250);
    expect(cut).toBe(true);
    expect(chunks.join('').length).toBeLessThanOrEqual(250);
  });

  test('text without a line break to split at is cut', () => {
    expect(listSlackChunks('x'.repeat(500), 100, 1000)).toEqual({ chunks: [], cut: true });
  });
});
