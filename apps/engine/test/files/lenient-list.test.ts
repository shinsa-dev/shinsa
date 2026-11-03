import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { createLenientList } from '../../src/files/lenient-list.ts';

const Entry = Schema.Struct({ id: Schema.String, size: Schema.Number });

const decode = Schema.decodeUnknownSync(createLenientList(Entry));

describe('createLenientList', () => {
  test('keeps the entries that decode and drops the rest', () => {
    expect(decode([{ id: 'a', size: 1 }, { id: 2 }, null, { id: 'b', size: 2, extra: true }])).toEqual([
      { id: 'a', size: 1 },
      { id: 'b', size: 2 },
    ]);
  });

  test('answers an empty list for anything that is not a list', () => {
    expect(decode({ id: 'a' })).toEqual([]);
    expect(decode('a')).toEqual([]);
  });

  test('encodes a list as it is', () => {
    expect(Schema.encodeSync(createLenientList(Entry))([{ id: 'a', size: 1 }])).toEqual([
      { id: 'a', size: 1 },
    ]);
  });
});
