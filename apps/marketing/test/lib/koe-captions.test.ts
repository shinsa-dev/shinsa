import { describe, expect, it } from 'bun:test';
import { resolveCaptionWords } from '../../src/lib/content.ts';

describe('resolveCaptionWords', () => {
  it('starts the first word with the line and spreads the rest by length', () => {
    const words = resolveCaptionWords({ start: 2, end: 4, text: 'Make it bigger' });
    expect(words.map((word) => word.text)).toEqual(['Make', 'it', 'bigger']);
    expect(words[0]!.at).toBe(2);
    expect(words[1]!.at).toBeCloseTo(2 + (1.6 * 5) / 15);
    expect(words[2]!.at).toBeCloseTo(2 + (1.6 * 8) / 15);
  });

  it('shows every word before the line ends', () => {
    const words = resolveCaptionWords({ start: 0, end: 1, text: 'one two three four' });
    expect(Math.max(...words.map((word) => word.at))).toBeLessThan(0.8);
  });
});
