import { describe, expect, test } from 'bun:test';
import { parseChoiceValue, resolveDisplayPath, serializeChoiceValue } from '../../src/protocol/onboarding.ts';

describe('resolveDisplayPath', () => {
  test('writes folders inside the home folder with ~ and leaves the rest whole', () => {
    expect(resolveDisplayPath('/Users/me', '/Users/me')).toBe('~');
    expect(resolveDisplayPath('/Users/me/Developer/app', '/Users/me/')).toBe('~/Developer/app');
    expect(resolveDisplayPath('/Users/mel/code', '/Users/me')).toBe('/Users/mel/code');
    expect(resolveDisplayPath('/srv/code', '/Users/me')).toBe('/srv/code');
    expect(resolveDisplayPath('/srv/code', '')).toBe('/srv/code');
  });
});

describe('choice values', () => {
  test('name the group and the pick, and read back the same way', () => {
    expect(serializeChoiceValue('model', 'claude-opus-5-5')).toBe('model=claude-opus-5-5');
    expect(parseChoiceValue('model=claude-opus-5-5')).toEqual({ group: 'model', value: 'claude-opus-5-5' });
    expect(parseChoiceValue('merge=')).toEqual({ group: 'merge', value: '' });
  });

  test('a value without a group is not a choice', () => {
    expect(parseChoiceValue('squash')).toBeNull();
    expect(parseChoiceValue('=squash')).toBeNull();
  });
});
