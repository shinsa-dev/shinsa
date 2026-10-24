import type { CodeSpot } from '@shinsa/core';

const SNIPPET_CONTEXT = 1;

const SNIPPET_MAX_LINES = 14;

export interface SnippetLine {
  number: number;
  text: string;
  inRange: boolean;
}

export function resolveSnippet(content: string, spot: CodeSpot): SnippetLine[] {
  const lines = content.replace(/\n$/, '').split('\n');
  const first = Math.max(1, spot.start - SNIPPET_CONTEXT);
  const last = Math.min(lines.length, spot.end + SNIPPET_CONTEXT, first + SNIPPET_MAX_LINES - 1);
  return lines.slice(first - 1, last).map((text, index) => {
    const number = first + index;
    return { number, text, inRange: number >= spot.start && number <= spot.end };
  });
}
