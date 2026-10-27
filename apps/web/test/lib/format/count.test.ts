import { describe, expect, it } from 'bun:test';
import {
  endSentence,
  flattenWhitespace,
  formatBytes,
  formatCount,
  formatLineRange,
  formatSteps,
} from '@/lib/format/count.ts';

describe('formatCount', () => {
  it('agrees the noun with the number', () => {
    expect(formatCount(0, 'task', 'tasks')).toBe('0 tasks');
    expect(formatCount(1, 'task', 'tasks')).toBe('1 task');
    expect(formatCount(2, 'task', 'tasks')).toBe('2 tasks');
  });

  it('counts steps the same way', () => {
    expect(formatSteps(1)).toBe('1 step');
    expect(formatSteps(3)).toBe('3 steps');
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
