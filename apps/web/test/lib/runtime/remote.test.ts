import { describe, expect, it } from 'bun:test';
import { ClaimCode, InstanceId, REMOTE_PATHS } from '@shinsa/core';
import { Effect } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { RemoteClient } from '@/lib/runtime/remote/service.ts';
import { answerFetch } from '../../support/fetch-fake.ts';

function callRemote<A, E>(call: (remote: RemoteClient['Service']) => Effect.Effect<A, E>) {
  return Effect.gen(function* () {
    return yield* call(yield* RemoteClient);
  });
}

const USER = { id: '7', login: 'kai', name: 'Kai', avatarUrl: null };

const readSession = callRemote((remote) => remote.session.read());

const listInstances = callRemote((remote) => remote.instances.list());

describe('RemoteClient', () => {
  it('reads the session and the machines with the page’s own cookie', async () => {
    const requests = answerFetch(({ path }) =>
      Response.json(path === REMOTE_PATHS.session ? { user: USER } : [])
    );
    expect(await runApp(readSession)).toEqual({ user: USER });
    expect(await runApp(listInstances)).toEqual([]);
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET ${REMOTE_PATHS.session}`,
      `GET ${REMOTE_PATHS.instances}`,
    ]);
    expect(requests[1]?.headers.has('authorization')).toBe(false);
  });

  it('reaches the groups a page uses', async () => {
    const requests = answerFetch(() => Response.json({ ok: true }));
    await runApp(
      callRemote((remote) =>
        Effect.all([
          Effect.flip(remote.pairs.view({ params: { claimCode: ClaimCode.make('ABCD-1234') } })),
          Effect.flip(remote.shares.connect({ params: { instanceId: InstanceId.make('m1') } })),
          remote.teams.list().pipe(Effect.flip),
        ])
      )
    );
    expect(requests.map(({ path }) => path)).toEqual([
      `${REMOTE_PATHS.pairs}/ABCD-1234`,
      `${REMOTE_PATHS.shares}/m1/connect`,
      REMOTE_PATHS.teams,
    ]);
  });

  it('fails with Shinsa Cloud’s own code and message when it refuses', async () => {
    answerFetch(() =>
      Response.json({ error: { code: 'signed_out', message: 'Sign in again.' } }, { status: 401 })
    );
    expect(await runApp(Effect.flip(listInstances))).toMatchObject({
      _tag: 'CloudRefused',
      status: 401,
      code: 'signed_out',
      message: 'Sign in again.',
    });
  });

  it('names the status when a refusal has no readable body', async () => {
    answerFetch(() => new Response('', { status: 502 }));
    expect(await runApp(Effect.flip(listInstances))).toMatchObject({
      _tag: 'CloudRefused',
      status: 502,
      code: 'failed',
      message: 'Shinsa Cloud answered 502.',
    });
  });

  it('fails as unreachable when the request cannot be sent', async () => {
    answerFetch(() => {
      throw new TypeError('offline');
    });
    expect(await runApp(Effect.flip(readSession))).toMatchObject({
      _tag: 'CloudUnreachable',
      message: 'Couldn’t reach Shinsa Cloud.',
    });
  });

  it('fails as unreadable when an answer breaks its schema', async () => {
    answerFetch(() => Response.json({ user: 'kai' }));
    expect(await runApp(Effect.flip(readSession))).toMatchObject({
      _tag: 'CloudAnswerInvalid',
      message: 'Shinsa Cloud sent an answer this page can’t read.',
    });
  });
});
