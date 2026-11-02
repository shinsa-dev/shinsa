import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { Count, MemberRow } from '../../src/store/shared/schema.ts';

describe('shared row schemas', () => {
  test('a count row decodes to its number and encodes back', () => {
    expect(Schema.decodeUnknownSync(Count)({ total: 3 })).toBe(3);
    expect(Schema.encodeSync(Count)(3)).toEqual({ total: 3 });
  });

  test('a member row decodes to the user and when they were added, and encodes back', () => {
    const row = { id: '7', login: 'kai', name: null, avatarUrl: null, addedAt: 5 };
    const member = Schema.decodeUnknownSync(MemberRow)(row);
    expect(member).toEqual({ user: { id: '7', login: 'kai', name: null, avatarUrl: null }, addedAt: 5 });
    expect(Schema.encodeSync(MemberRow)(member)).toEqual(row);
  });
});
