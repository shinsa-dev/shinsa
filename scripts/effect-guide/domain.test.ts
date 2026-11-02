import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { MachineId, parsePairRequest } from './domain.ts';

describe('a request body is decoded once, at the edge, into a typed value or a tagged error', () => {
  test('a valid body decodes to the branded shape', async () => {
    const request = await Effect.runPromise(parsePairRequest('{"id":"studio-mac","name":"Studio"}'));
    expect(request).toEqual({ id: MachineId.make('studio-mac'), name: 'Studio' });
  });

  test('text that is not JSON and a field that breaks its check both fail as InvalidPayload', async () => {
    const notJson = await Effect.runPromise(Effect.flip(parsePairRequest('{')));
    const badId = await Effect.runPromise(
      Effect.flip(parsePairRequest('{"id":"Studio Mac","name":"Studio"}'))
    );
    expect(notJson._tag).toBe('InvalidPayload');
    expect(badId._tag).toBe('InvalidPayload');
    expect(badId.message).toContain('id');
  });
});
