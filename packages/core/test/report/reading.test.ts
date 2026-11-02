import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import {
  CountUpTo,
  Flag,
  HandOverReader,
  HandOverRecord,
  Items,
  LineNumber,
  ListOrRecord,
  OptionalOneOf,
  OptionalText,
  OptionalWholeRecord,
  OrAbsent,
  OrOmitted,
  OneOf,
  ReadWhen,
  Required,
} from '../../src/report/reading.ts';

function readWith<S extends Schema.Top>(schema: S, value: unknown) {
  const reader = new HandOverReader();
  const read = reader.read(schema, value, ['field']);
  return { read, errors: reader.errors };
}

describe('the hand-over reader', () => {
  test('trims text, and names a missing or overlong one by its path', () => {
    expect(readWith(Required(5), ' abc ')).toEqual({ read: 'abc', errors: [] });
    expect(readWith(Required(5), 'abcdefg')).toEqual({
      read: 'abcdefg',
      errors: ['field is 7 characters; the limit is 5.'],
    });
    expect(readWith(Required(5), 4)).toEqual({ read: '', errors: ['field is required.'] });
    expect(readWith(OptionalText(5), '')).toEqual({ read: null, errors: [] });
    expect(readWith(OptionalText(5), ' ')).toEqual({ read: '', errors: ['field is required.'] });
  });

  test('a list keeps going past its limit and names each broken item', () => {
    expect(readWith(Items(LineNumber, 2, 1), [1, 0, 3])).toEqual({
      read: [1, 0],
      errors: ['field has 3 items; the limit is 2.', 'field[1] must be a line number (1 or more).'],
    });
    expect(readWith(Items(LineNumber, 2, 1), 'x')).toEqual({ read: [], errors: ['field must be a list.'] });
    expect(readWith(Items(LineNumber, 2), undefined)).toEqual({ read: [], errors: [] });
  });

  test('a record that is not an object still names each field, unless it halts', () => {
    const fields = { count: CountUpTo(3), flag: Flag };
    expect(readWith(HandOverRecord(fields), 'x')).toEqual({
      read: { count: 1, flag: false },
      errors: ['field must be an object.', 'field.count must be a whole number from 1 to 3.'],
    });
    expect(readWith(OptionalWholeRecord(fields), 'x')).toEqual({
      read: null,
      errors: ['field must be an object.'],
    });
  });

  test('reads a field only when the record before it allows it', () => {
    const Change = HandOverRecord({
      action: OneOf(['add', 'remove']),
      id: ReadWhen(Required(3), ({ action }: { action: string }) => action === 'remove'),
    });
    expect(readWith(Change, { action: 'add', id: 7 })).toEqual({
      read: { action: 'add', id: null },
      errors: [],
    });
    expect(readWith(Change, { action: 'remove' })).toEqual({
      read: { action: 'remove', id: '' },
      errors: ['field.id is required.'],
    });
  });

  test('tells absent from omitted, and a list from a record', () => {
    expect(readWith(OrAbsent(Flag), null)).toEqual({ read: null, errors: [] });
    expect(readWith(OrOmitted(Flag), null)).toEqual({
      read: false,
      errors: ['field must be true or false.'],
    });
    const Either = ListOrRecord(Items(Flag, 2), HandOverRecord({ flag: Flag }));
    expect(readWith(Either, [true])).toEqual({ read: [true], errors: [] });
    expect(readWith(Either, { flag: true })).toEqual({ read: { flag: true }, errors: [] });
  });

  test('an optional choice takes an empty string as none and names the others', () => {
    expect(readWith(OptionalOneOf(['light', 'dark']), '')).toEqual({ read: null, errors: [] });
    expect(readWith(OptionalOneOf(['light', 'dark']), 'sepia')).toEqual({
      read: 'light',
      errors: ['field must be one of light, dark.'],
    });
  });
});

describe('the hand-over schemas encode what they decode', () => {
  test('absent values, flags, optional text and choices encode back', () => {
    expect(Schema.encodeSync(OrOmitted(Flag))(null)).toBeUndefined();
    expect(Schema.encodeSync(Flag)(true)).toBe(true);
    expect(Schema.encodeSync(Flag)(false)).toBeUndefined();
    expect(Schema.encodeSync(OptionalText(5))('abc')).toBe('abc');
    expect(Schema.encodeSync(OptionalOneOf(['light', 'dark']))('dark')).toBe('dark');
  });
});
