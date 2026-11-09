import { describe, expect, test } from 'bun:test';
import { resolvePlanKey, resolvePlanLabel } from '../../src/index.ts';

describe('resolvePlanLabel', () => {
  test('writes the plan the way Claude names it', () => {
    expect(resolvePlanLabel('max')).toBe('Max');
    expect(resolvePlanLabel('claude_pro')).toBe('Pro');
    expect(resolvePlanLabel('TEAM')).toBe('Team');
    expect(resolvePlanLabel('enterprise')).toBe('Enterprise');
    expect(resolvePlanLabel('max_20x')).toBe('Max 20x');
    expect(resolvePlanLabel('ultra')).toBe('Ultra');
    expect(resolvePlanLabel('Claude Ultra')).toBe('Ultra');
    expect(resolvePlanLabel(null)).toBeNull();
  });
});

describe('resolvePlanKey', () => {
  test('names one plan the same way however Claude spells it', () => {
    expect(resolvePlanKey('Claude Ultra')).toBe('ultra');
    expect(resolvePlanKey('ultra')).toBe('ultra');
    expect(resolvePlanKey('claude_max')).toBe('max');
    expect(resolvePlanKey('Max 20x')).toBe('max_20x');
    expect(resolvePlanKey('max-20x')).toBe('max_20x');
  });

  test('has no key for a missing or empty plan', () => {
    expect(resolvePlanKey(null)).toBeNull();
    expect(resolvePlanKey('  ')).toBeNull();
    expect(resolvePlanKey('Claude')).toBeNull();
  });
});
