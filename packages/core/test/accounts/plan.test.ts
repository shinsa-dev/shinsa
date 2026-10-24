import { describe, expect, test } from 'bun:test';
import { resolvePlanLabel } from '../../src/index.ts';

describe('resolvePlanLabel', () => {
  test('writes the plan the way Claude names it', () => {
    expect(resolvePlanLabel('max')).toBe('Max');
    expect(resolvePlanLabel('claude_pro')).toBe('Pro');
    expect(resolvePlanLabel('TEAM')).toBe('Team');
    expect(resolvePlanLabel('enterprise')).toBe('Enterprise');
    expect(resolvePlanLabel('max_20x')).toBe('Max 20x');
    expect(resolvePlanLabel(null)).toBeNull();
  });
});
