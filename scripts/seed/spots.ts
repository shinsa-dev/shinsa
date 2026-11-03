import type { CodeSpot } from '../../packages/core/src/index.ts';

export function lineOf(content: string, needle: string) {
  const index = content.split('\n').findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`Seed text not found: ${needle}`);
  return index + 1;
}

interface SpotNote {
  title: string;
  why: string;
  explain: string;
}

export function spot(
  file: string,
  content: string,
  from: string,
  to: string,
  attention: CodeSpot['attention'],
  note: SpotNote
): CodeSpot {
  return { file, start: lineOf(content, from), end: lineOf(content, to), attention, ...note };
}

export function rangeOf(content: string, from: string, to: string) {
  return { line: lineOf(content, from), end: lineOf(content, to) };
}
