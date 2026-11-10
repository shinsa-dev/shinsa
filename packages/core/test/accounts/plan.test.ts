import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import { resolvePlanKey, resolvePlanLabel } from '../../src/index.ts';

describe('resolvePlanLabel', () => {
  test('writes the plan the way Claude names it', () => {
    expect(Option.getOrNull(resolvePlanLabel('max'))).toBe('Max');
    expect(Option.getOrNull(resolvePlanLabel('claude_pro'))).toBe('Pro');
    expect(Option.getOrNull(resolvePlanLabel('TEAM'))).toBe('Team');
    expect(Option.getOrNull(resolvePlanLabel('enterprise'))).toBe('Enterprise');
    expect(Option.getOrNull(resolvePlanLabel('max_20x'))).toBe('Max 20x');
    expect(Option.getOrNull(resolvePlanLabel('ultra'))).toBe('Ultra');
    expect(Option.getOrNull(resolvePlanLabel('Claude Ultra'))).toBe('Ultra');
    expect(Option.getOrNull(resolvePlanLabel(null))).toBeNull();
  });
});

describe('resolvePlanKey', () => {
  test('names one plan the same way however Claude spells it', () => {
    expect(Option.getOrNull(resolvePlanKey('Claude Ultra'))).toBe('ultra');
    expect(Option.getOrNull(resolvePlanKey('ultra'))).toBe('ultra');
    expect(Option.getOrNull(resolvePlanKey('claude_max'))).toBe('max');
    expect(Option.getOrNull(resolvePlanKey('Max 20x'))).toBe('max_20x');
    expect(Option.getOrNull(resolvePlanKey('max-20x'))).toBe('max_20x');
  });

  test('has no key for a missing or empty plan', () => {
    expect(Option.getOrNull(resolvePlanKey(null))).toBeNull();
    expect(Option.getOrNull(resolvePlanKey('  '))).toBeNull();
    expect(Option.getOrNull(resolvePlanKey('Claude'))).toBeNull();
  });
});
