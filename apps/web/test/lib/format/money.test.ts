import { describe, expect, it } from 'bun:test';
import { formatCompactUsd, formatCost, formatTokenCount, formatTokens } from '@/lib/format/money.ts';

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
    expect(formatTokens(48_200)).toBe('48.2k tokens');
    expect(formatTokens(2_340_000)).toBe('2.3M tokens');
  });

  it('formats a token count on its own, for a phrase that names the noun once', () => {
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(84_000)).toBe('84k');
    expect(formatTokenCount(1_000_000)).toBe('1M');
  });

  it('keeps a token count compact through billions and trillions', () => {
    expect(formatTokenCount(15_400)).toBe('15.4k');
    expect(formatTokenCount(154_400)).toBe('154k');
    expect(formatTokenCount(3_263_200_000)).toBe('3.3B');
    expect(formatTokenCount(3_000_000_000)).toBe('3B');
    expect(formatTokenCount(1_240_000_000_000)).toBe('1.2T');
    expect(formatTokenCount(4_500_000_000_000_000)).toBe('4500T');
  });

  it('moves up a unit instead of rounding to a thousand of the one below', () => {
    expect(formatTokenCount(999_960)).toBe('1M');
    expect(formatTokenCount(999_960_000)).toBe('1B');
    expect(formatTokenCount(99_960)).toBe('100k');
  });

  it('keeps a cost exact to the cent under a thousand dollars and compact above', () => {
    expect(formatCompactUsd(0.004)).toBe('<$0.01');
    expect(formatCompactUsd(999.99)).toBe('$999.99');
    expect(formatCompactUsd(999.996)).toBe('$1K');
    expect(formatCompactUsd(1_310.38)).toBe('$1.3K');
    expect(formatCompactUsd(15_400)).toBe('$15.4K');
    expect(formatCompactUsd(2_140_000)).toBe('$2.1M');
  });
});
