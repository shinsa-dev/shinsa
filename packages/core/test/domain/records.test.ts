import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import { isRecord, parseJsonRecord } from '../../src/domain/records.ts';

describe('isRecord', () => {
  test('accepts a plain object and refuses arrays, null and primitives', () => {
    expect(isRecord({ id: 'a' })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('text')).toBe(false);
  });
});

describe('parseJsonRecord', () => {
  test('reads a JSON object and refuses an array, a primitive or broken JSON', () => {
    expect(parseJsonRecord('{"id":"a"}')).toEqual(Option.some({ id: 'a' }));
    expect(parseJsonRecord('[1]')).toEqual(Option.none());
    expect(parseJsonRecord('1')).toEqual(Option.none());
    expect(parseJsonRecord('null')).toEqual(Option.none());
    expect(parseJsonRecord('{')).toEqual(Option.none());
  });
});
