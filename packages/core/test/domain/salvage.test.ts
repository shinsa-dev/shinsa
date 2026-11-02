import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import {
  Salvaged,
  SalvagedItems,
  SalvagedOrNull,
  SalvagedOrOmitted,
  Truncated,
} from '../../src/domain/salvage.ts';

const Answer = Schema.Struct({
  name: SalvagedOrNull(Schema.NonEmptyString),
  mode: Salvaged(Schema.Literals(['fast', 'slow']), (): 'fast' | 'slow' => 'fast'),
  title: SalvagedOrOmitted(Schema.NonEmptyString),
  tags: SalvagedItems(Schema.NonEmptyString),
  recent: SalvagedItems(Schema.Number, 2),
  note: Truncated(5),
});

const decodeAnswer = Schema.decodeUnknownSync(Answer);

describe('salvaged fields', () => {
  test('a missing or malformed field reads as its fallback, never as a refusal', () => {
    expect(decodeAnswer({ note: '' })).toEqual({ name: null, mode: 'fast', tags: [], recent: [], note: '' });
    expect(decodeAnswer({ name: '', mode: 'warp', title: 7, tags: 'x', recent: {}, note: '' })).toEqual({
      name: null,
      mode: 'fast',
      tags: [],
      recent: [],
      note: '',
    });
  });

  test('keeps what is well formed, drops the rest of a list, and keeps only its last entries', () => {
    expect(
      decodeAnswer({
        name: 'Ada',
        mode: 'slow',
        title: 'Lead',
        tags: ['a', '', 3, 'b'],
        recent: [1, 2, 'x', 4],
        note: 'longer than five',
      })
    ).toEqual({ name: 'Ada', mode: 'slow', title: 'Lead', tags: ['a', 'b'], recent: [4], note: 'longe' });
  });

  test('a truncated field still has to be text', () => {
    expect(Schema.decodeUnknownOption(Answer)({ note: 5 })._tag).toBe('None');
  });

  test('what was salvaged encodes back as it is', () => {
    const answer = decodeAnswer({ name: 'Ada', tags: ['a'], note: 'hi' });
    expect(Schema.encodeSync(Answer)(answer)).toEqual(answer);
  });
});
