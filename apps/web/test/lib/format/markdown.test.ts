import { describe, expect, it } from 'bun:test';
import { stripInlineMarkdown, stripMarkdown } from '@/lib/format/markdown.ts';

describe('stripInlineMarkdown', () => {
  it('keeps a link’s label and drops code and bold marks', () => {
    expect(stripInlineMarkdown(' See [retry.ts](shinsa://file/src/retry.ts) and **`retry()`** ')).toBe(
      'See retry.ts and retry()'
    );
  });
});

describe('stripMarkdown', () => {
  it('drops headings, quotes and list marks at the start of a line, and keeps a literal star in prose', () => {
    expect(stripMarkdown('## Summary\n> Quoted\n- First\n* Second\nTwice 2 * 3.')).toBe(
      'Summary\nQuoted\nFirst\nSecond\nTwice 2 * 3.'
    );
  });
});
