import { describe, expect, test } from 'bun:test';
import {
  CODEX_PRICES,
  type CodexTokens,
  resolveCacheLifetimeMs,
  resolveCodexCost,
  resolveCodexPriceModel,
} from '../../../../src/agents/providers/codex/pricing.ts';

const MILLION: CodexTokens = {
  inputTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
  cacheWriteTokens: 1_000_000,
  outputTokens: 1_000_000,
};

const STANDARD = { longContext: false, fast: false };

describe('the Codex price table', () => {
  test('prices each kind of token at the model’s published rate per million', () => {
    expect(resolveCodexCost('gpt-6-astra', MILLION, STANDARD)).toBeCloseTo(10 + 1 + 12.5 + 50);
    expect(resolveCodexCost('gpt-5.6-luna', MILLION, STANDARD)).toBeCloseTo(0.2 + 0.02 + 0.25 + 1.2);
  });

  test('a model without a cache rate charges cached and written tokens as input', () => {
    expect(resolveCodexCost('gpt-5-pro', MILLION, STANDARD)).toBeCloseTo(15 * 3 + 120);
  });

  test('a request past 272K input tokens doubles input and takes the long-context output rate', () => {
    const long = { longContext: true, fast: false };
    expect(resolveCodexCost('gpt-6-astra', MILLION, long)).toBeCloseTo(20 + 2 + 25 + 75);
    expect(resolveCodexCost('gpt-5.2', MILLION, long)).toBeCloseTo(1.75 * 2 + 0.175 + 14);
  });

  test('fast mode multiplies the published rate, and a model without a fast price is unknown', () => {
    expect(resolveCodexCost('gpt-6-astra', MILLION, { longContext: false, fast: true })).toBeCloseTo(147);
    expect(resolveCodexCost('gpt-5.5', MILLION, { longContext: false, fast: true })).toBeCloseTo(
      (5 + 0.5 + 5 + 30) * 2.5
    );
    expect(resolveCodexCost('gpt-5.2', MILLION, { longContext: false, fast: true })).toBeNull();
  });

  test('fast long-context requests are priced only where OpenAI publishes the rate', () => {
    expect(resolveCodexCost('gpt-6-astra', MILLION, { longContext: true, fast: true })).toBeCloseTo(244);
    expect(resolveCodexCost('gpt-5.6-sol', MILLION, { longContext: true, fast: true })).toBeNull();
  });

  test('an unknown model, or none, stays unknown and is never free', () => {
    expect(resolveCodexCost('gpt-9-nova', MILLION, STANDARD)).toBeNull();
    expect(resolveCodexCost(null, MILLION, STANDARD)).toBeNull();
    expect(resolveCodexCost('gpt-5.3-codex-spark', MILLION, STANDARD)).toBeNull();
  });

  test('aliases, provider prefixes, context suffixes and dated snapshots resolve to their row', () => {
    expect(resolveCodexPriceModel('openai/gpt-5.4')).toBe('gpt-5.4');
    expect(resolveCodexPriceModel('gpt-5.6')).toBe('gpt-5.6-sol');
    expect(resolveCodexPriceModel('gpt-reserve')).toBe('gpt-5.6-luna');
    expect(resolveCodexPriceModel('gpt-daybreak-red-latest')).toBe('gpt-5.6-cyber');
    expect(resolveCodexPriceModel('gpt-5.2-2026-03-01')).toBe('gpt-5.2');
    expect(resolveCodexPriceModel('gpt-6-astra[1m]')).toBe('gpt-6-astra');
    expect(resolveCodexPriceModel('gpt-9-2026-03-01')).toBeNull();
  });

  test('every default Codex model has a price', () => {
    for (const model of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])
      expect(CODEX_PRICES[model]).toBeDefined();
  });
});

describe('how long Codex’s prompt cache lasts', () => {
  test('GPT-5.6 and later keep a prefix at least 30 minutes, older models at least 5', () => {
    expect(resolveCacheLifetimeMs('gpt-6-astra')).toBe(30 * 60_000);
    expect(resolveCacheLifetimeMs('gpt-5.6-luna')).toBe(30 * 60_000);
    expect(resolveCacheLifetimeMs('gpt-5.6')).toBe(30 * 60_000);
    expect(resolveCacheLifetimeMs('gpt-5')).toBe(5 * 60_000);
    expect(resolveCacheLifetimeMs('gpt-5.2-codex')).toBe(5 * 60_000);
    expect(resolveCacheLifetimeMs('o3')).toBe(5 * 60_000);
    expect(resolveCacheLifetimeMs(null)).toBe(5 * 60_000);
  });
});
