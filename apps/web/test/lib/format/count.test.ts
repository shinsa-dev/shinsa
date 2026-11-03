import { describe, expect, it } from 'bun:test';
import {
  endSentence,
  flattenWhitespace,
  formatBytes,
  formatLineRange,
  formatNumber,
  formatPercent,
  formatSteps,
} from '@/lib/format/count.ts';

describe('formatSteps', () => {
  it('agrees the noun with the number', () => {
    expect(formatSteps(0)).toBe('0 steps');
    expect(formatSteps(1)).toBe('1 step');
    expect(formatSteps(3)).toBe('3 steps');
  });
});

describe('formatNumber', () => {
  it('groups thousands the same in every locale', () => {
    expect(formatNumber(42)).toBe('42');
    expect(formatNumber(3291)).toBe('3,291');
    expect(formatNumber(1_234_567)).toBe('1,234,567');
  });
});

describe('formatPercent', () => {
  it('rounds a rate to a whole percent, and reads none without one', () => {
    expect(formatPercent(0.414)).toBe('41%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(null)).toBe('None');
  });
});

describe('formatLineRange', () => {
  it('names a single line or a range with an en dash', () => {
    expect(formatLineRange(4, 4)).toBe('line 4');
    expect(formatLineRange(4, 9)).toBe('lines 4–9');
  });
});

describe('formatBytes', () => {
  it('moves to megabytes before showing 1024 KB', () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe('1.0 MB');
  });

  it('picks bytes, kilobytes or megabytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('moves to gigabytes before showing 1024.0 MB', () => {
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe('1.0 GB');
    expect(formatBytes(3.25 * 1024 * 1024 * 1024)).toBe('3.3 GB');
  });
});

describe('endSentence', () => {
  it('adds a full stop only when the sentence has no ending', () => {
    expect(endSentence('Merge it')).toBe('Merge it.');
    expect(endSentence('Merge it.')).toBe('Merge it.');
    expect(endSentence('Ready?')).toBe('Ready?');
    expect(endSentence('Wait!')).toBe('Wait!');
    expect(endSentence('And then…')).toBe('And then…');
  });

  it('sees an ending inside a closing quote or bracket', () => {
    expect(endSentence('Then review “Fix login.”')).toBe('Then review “Fix login.”');
    expect(endSentence('It passed (all of it.)')).toBe('It passed (all of it.)');
  });
});

describe('flattenWhitespace', () => {
  it('joins lines and collapses runs of spaces', () => {
    expect(flattenWhitespace('  one\n\ntwo\t three  ')).toBe('one two three');
  });
});
