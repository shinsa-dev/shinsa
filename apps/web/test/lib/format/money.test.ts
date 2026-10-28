import { describe, expect, it } from 'bun:test';
import { formatCost, formatTokenCount, formatTokens } from '@/lib/format/money.ts';

const LINE = {
  runs: 2,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  tokens: 0,
  weeklyPercent: 0,
  weeklyRuns: 0,
  weeklyTasks: 0,
  learningRuns: 0,
  estimatedPercent: 0,
};

describe('money', () => {
  it('formats a mix of known and unknown prices', () => {
    expect(formatCost({ ...LINE, knownUsd: 0.3, unpricedRuns: 1 })).toBe('$0.30 + unknown');
    expect(formatCost({ ...LINE, knownUsd: 1.5, unpricedRuns: 0 })).toBe('$1.50');
    expect(formatCost({ ...LINE, knownUsd: 0, unpricedRuns: 2 })).toBe('Unknown');
  });

  it('formats every token size', () => {
    expect(formatTokens(950)).toBe('950 tokens');
    expect(formatTokens(48_200)).toBe('48k tokens');
    expect(formatTokens(2_340_000)).toBe('2.3M tokens');
  });

  it('formats a token count on its own, for a phrase that names the noun once', () => {
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(84_000)).toBe('84k');
    expect(formatTokenCount(1_000_000)).toBe('1.0M');
  });
});
