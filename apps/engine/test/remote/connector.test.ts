import { describe, expect, test } from 'bun:test';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCloudflaredConnector, createInstalledConnector } from '../../src/remote/connector.ts';
import { createTempDir } from '../helpers/index.ts';

function writeFake(script: string) {
  const dir = createTempDir();
  const path = join(dir, 'cloudflared');
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return { path, dir };
}

describe('the cloudflared connector', () => {
  test('passes the token in the environment, never in the arguments, and resolves once connected', async () => {
    const fake = writeFake(
      'echo "$@" > "$(dirname "$0")/args"; echo "$TUNNEL_TOKEN" > "$(dirname "$0")/token"; echo "INF Registered tunnel connection" >&2; exec sleep 30'
    );
    const connect = createCloudflaredConnector({ binary: () => Promise.resolve(fake.path) });
    const connector = await connect('secret-token', 'http://127.0.0.1:7446');
    expect(readFileSync(join(fake.dir, 'args'), 'utf8').trim()).toBe(
      'tunnel --no-autoupdate run --url http://127.0.0.1:7446'
    );
    expect(readFileSync(join(fake.dir, 'token'), 'utf8').trim()).toBe('secret-token');
    connector.stop();
    await connector.exited;
  });

  test('fails with the last line it printed when cloudflared exits before connecting', async () => {
    const fake = writeFake('echo "ERR bad token" >&2; exit 1');
    const connect = createCloudflaredConnector({ binary: () => Promise.resolve(fake.path), env: {} });
    await expect(connect('t', 'http://127.0.0.1:1')).rejects.toThrow('code 1: ERR bad token');
  });

  test('stops cloudflared and fails when it does not connect in time', async () => {
    const fake = writeFake('exec sleep 30');
    const connect = createCloudflaredConnector({ binary: () => Promise.resolve(fake.path), timeoutMs: 50 });
    await expect(connect('t', 'http://127.0.0.1:1')).rejects.toThrow('did not connect');
  });

  test('installs cloudflared for this computer before it connects, and says when there is no build for it', async () => {
    const connect = createInstalledConnector(createTempDir(), 'win32', 'x64');
    await expect(connect('t', 'http://127.0.0.1:1')).rejects.toThrow('no build for this computer');
  });
});
