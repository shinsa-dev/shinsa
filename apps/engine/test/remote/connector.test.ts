import { describe, expect, test } from 'bun:test';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { type Duration, Effect, Layer, Redacted } from 'effect';
import { Cloudflared } from '../../src/remote/cloudflared/service.ts';
import { createInstalledConnector } from '../../src/remote/connector/installed.ts';
import { createRefusedConnector } from '../../src/remote/connector/refused.ts';
import { ConnectTimeout } from '../../src/remote/connector/schema.ts';
import { TunnelConnector } from '../../src/remote/connector/service.ts';
import { createTempDir } from '../helpers/index.ts';

function writeFake(script: string) {
  const dir = createTempDir();
  const path = join(dir, 'cloudflared');
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return { path, dir };
}

function provideFake(path: string, timeout?: Duration.Input) {
  return Effect.provide(
    TunnelConnector.cloudflared.pipe(
      Layer.provide(Layer.succeed(Cloudflared, { install: Effect.succeed(path) })),
      Layer.provide(timeout ? Layer.succeed(ConnectTimeout, timeout) : Layer.empty),
      Layer.provide(BunServices.layer)
    )
  );
}

function open(tunnelToken: string, localUrl: string) {
  return TunnelConnector.use((connector) => connector.open(Redacted.make(tunnelToken), localUrl));
}

describe('the cloudflared connector', () => {
  test('passes the token in the environment, never in the arguments, and succeeds once connected', async () => {
    const fake = writeFake(
      'echo "$@" > "$(dirname "$0")/args"; echo "$TUNNEL_TOKEN" > "$(dirname "$0")/token"; echo "INF Registered tunnel connection" >&2; exec sleep 30'
    );
    const exited = await Effect.runPromise(
      Effect.gen(function* () {
        const connection = yield* open('secret-token', 'http://127.0.0.1:7446');
        return connection.exited;
      }).pipe(Effect.scoped, provideFake(fake.path))
    );
    expect(readFileSync(join(fake.dir, 'args'), 'utf8').trim()).toBe(
      'tunnel --no-autoupdate run --url http://127.0.0.1:7446'
    );
    expect(readFileSync(join(fake.dir, 'token'), 'utf8').trim()).toBe('secret-token');
    await Effect.runPromise(exited);
  });

  test('fails with the last line it printed when cloudflared exits before connecting', async () => {
    const fake = writeFake('echo "ERR bad token" >&2; exit 1');
    const error = await Effect.runPromise(
      Effect.flip(open('t', 'http://127.0.0.1:1')).pipe(Effect.scoped, provideFake(fake.path))
    );
    expect(error).toMatchObject({
      _tag: 'TunnelConnectFailed',
      message: expect.stringContaining('code 1: ERR bad token'),
    });
  });

  test('stops cloudflared and fails when it does not connect in time', async () => {
    const fake = writeFake('exec sleep 30');
    const error = await Effect.runPromise(
      Effect.flip(open('t', 'http://127.0.0.1:1')).pipe(Effect.scoped, provideFake(fake.path, '50 millis'))
    );
    expect(error.message).toContain('did not connect');
  });

  test('says when cloudflared cannot be started', async () => {
    const error = await Effect.runPromise(
      Effect.flip(open('t', 'http://127.0.0.1:1')).pipe(
        Effect.scoped,
        provideFake(join(createTempDir(), 'missing'))
      )
    );
    expect(error._tag).toBe('TunnelConnectFailed');
  });

  test('installs cloudflared for this computer before it connects, and says when there is no build for it', async () => {
    const error = await Effect.runPromise(
      Effect.flip(open('t', 'http://127.0.0.1:1')).pipe(
        Effect.scoped,
        Effect.provide(createInstalledConnector(createTempDir(), 'win32', 'x64'))
      )
    );
    expect(error.message).toContain('no build for this computer');
  });

  test('refuses every tunnel with its reason when an engine runs without one', async () => {
    const error = await Effect.runPromise(
      Effect.flip(open('t', 'http://127.0.0.1:1')).pipe(
        Effect.scoped,
        Effect.provide(createRefusedConnector('The preview runs no tunnel.'))
      )
    );
    expect(error).toMatchObject({ _tag: 'TunnelConnectFailed', message: 'The preview runs no tunnel.' });
  });
});
