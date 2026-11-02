import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Layer } from 'effect';
import { makeGuideHandler } from './handlers.ts';
import { ConfigTest, MachinesTest, SESSION_TOKEN } from './harness.ts';

let guide: ReturnType<typeof makeGuideHandler>;

beforeEach(() => {
  guide = makeGuideHandler(Layer.merge(MachinesTest, ConfigTest));
});

afterEach(() => guide.dispose());

const send = async (path: string, init: RequestInit = {}, token = SESSION_TOKEN) => {
  const response = await guide.handler(
    new Request(`http://guide.test${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
  );
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
};

describe('one API definition gives the routes, their checks and their error statuses', () => {
  test('a request without the right token is refused with 401 before any handler runs', async () => {
    const refused = await send('/machines', {}, 'wrong-token');
    expect(refused).toEqual({
      status: 401,
      body: { _tag: 'Unauthorized', message: 'Sign in again to continue.' },
    });
  });

  test('a paired machine is listed and found; a missing one is a 404 and a second pairing a 409', async () => {
    const paired = await send('/machines', {
      method: 'POST',
      body: JSON.stringify({ id: 'studio-mac', name: 'Studio' }),
    });
    expect(paired.status).toBe(200);
    expect(paired.body).toMatchObject({ id: 'studio-mac', name: 'Studio', status: 'online' });
    expect((await send('/machines')).body).toEqual([paired.body]);
    expect((await send('/machines/studio-mac')).body).toEqual(paired.body);
    expect(await send('/machines/laptop')).toEqual({
      status: 404,
      body: { _tag: 'MachineNotFound', machineId: 'laptop' },
    });
    const twice = await send('/machines', {
      method: 'POST',
      body: JSON.stringify({ id: 'studio-mac', name: 'Studio' }),
    });
    expect(twice.status).toBe(409);
  });

  test('a body or a path that breaks its schema is an empty 400 and never reaches the store', async () => {
    const invalid = await send('/machines', {
      method: 'POST',
      body: JSON.stringify({ id: 'Studio Mac', name: '' }),
    });
    expect(invalid).toEqual({ status: 400, body: null });
    expect(await send('/machines/Studio%20Mac')).toEqual({ status: 400, body: null });
    expect((await send('/machines')).body).toEqual([]);
  });
});
