import { describe, expect, it } from 'bun:test';
import type { CodeSpot } from '@shinsa/core';
import { resolveSnippet } from '@/lib/overview/snippet.ts';

function numbered(count: number) {
  return `${Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n')}\n`;
}

function spot(start: number, end = start): CodeSpot {
  return { file: 'a.ts', start, end, attention: 'normal', why: '' };
}

function describeLines(content: string, at: CodeSpot) {
  return resolveSnippet(content, at).map((line) => `${line.number}${line.inRange ? '*' : ''} ${line.text}`);
}

describe('resolveSnippet', () => {
  it('shows the spot with one line of context on each side', () => {
    expect(describeLines(numbered(20), spot(5, 6))).toEqual([
      '4 line 4',
      '5* line 5',
      '6* line 6',
      '7 line 7',
    ]);
  });

  it('starts at the first line when the spot is at the top', () => {
    expect(describeLines(numbered(20), spot(1))).toEqual(['1* line 1', '2 line 2']);
  });

  it('ends at the last line of the file, never on the empty line after its final newline', () => {
    expect(describeLines(numbered(20), spot(20))).toEqual(['19 line 19', '20* line 20']);
    expect(describeLines('one\ntwo', spot(2))).toEqual(['1 one', '2* two']);
  });

  it('keeps blank lines inside the file', () => {
    expect(describeLines('a\n\nc\n', spot(2))).toEqual(['1 a', '2* ', '3 c']);
  });

  it('caps a long spot at fourteen lines', () => {
    const lines = resolveSnippet(numbered(100), spot(10, 60));
    expect(lines).toHaveLength(14);
    expect(lines[0]?.number).toBe(9);
    expect(lines.at(-1)?.number).toBe(22);
    expect(lines[0]?.inRange).toBe(false);
    expect(lines.at(-1)?.inRange).toBe(true);
  });

  it('shows nothing for a spot past the end of the file', () => {
    expect(resolveSnippet(numbered(3), spot(10))).toEqual([]);
  });
});
