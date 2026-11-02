import { describe, expect, it } from 'bun:test';
import { Effect, Schema } from 'effect';
import { decodeAnswer } from '@/lib/runtime/engine/answers.ts';

const decodeCount = decodeAnswer(Schema.Struct({ count: Schema.Number }));

describe('decodeAnswer', () => {
  it('hands back an answer that fits its schema', async () => {
    expect(await Effect.runPromise(decodeCount({ count: 2 }))).toEqual({ count: 2 });
  });

  it('fails as unreadable when an answer breaks its schema', async () => {
    expect(await Effect.runPromise(Effect.flip(decodeCount({ count: 'two' })))).toMatchObject({
      _tag: 'EngineAnswerInvalid',
      message: 'Shinsa sent an answer this page can’t read.',
    });
  });
});
