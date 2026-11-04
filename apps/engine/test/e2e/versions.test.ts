import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { UpdateStreamLine, VersionsSnapshot } from '@shinsa/core';
import { Effect } from 'effect';
import type { ModelSource } from '../../src/agents/index.ts';
import { createTestConfig } from '../helpers/index.ts';
import { type Shinsa, startShinsa } from '../helpers/serve.ts';
import { createFakeVersionsLayer } from '../versions/fakes.ts';

setDefaultTimeout(30_000);

const models = { listModels: () => Promise.resolve([]) } as unknown as ModelSource;

const running: Shinsa[] = [];

afterEach(async () => {
  for (const shinsa of running.splice(0)) await shinsa.stop();
});

async function start(inspect = false) {
  const installed = { version: '2.1.287' };
  const shinsa = await startShinsa(createTestConfig(undefined, { inspect }), {
    models,
    versions: createFakeVersionsLayer({
      readVersion: () => installed.version,
      latest: () => Effect.succeed('2.1.310'),
      run: (_updater, onLine) =>
        Effect.sync(() => {
          onLine('Installing 2.1.310');
          installed.version = '2.1.310';
          return { ok: true, code: 0, stdout: '', stderr: '', timedOut: false };
        }),
    }),
  });
  running.push(shinsa);
  return shinsa;
}

function post(shinsa: Shinsa, body: unknown, accept = 'application/x-ndjson') {
  return fetch(`${shinsa.url}/api/versions/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: shinsa.url, accept },
    body: JSON.stringify(body),
  });
}

describe('updating an agent program, end to end', () => {
  test('streams the updater’s output, then the new versions', async () => {
    const shinsa = await start();
    const before = (await (await fetch(`${shinsa.url}/api/versions`)).json()) as VersionsSnapshot;
    expect(before.programs[0]).toMatchObject({
      version: '2.1.287',
      latest: '2.1.310',
      status: 'update_available',
    });
    const lines = (await (await post(shinsa, { program: 'claude' })).text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as UpdateStreamLine);
    expect(lines[0]).toEqual({ type: 'output', line: 'Installing 2.1.310' });
    expect(lines[1]).toMatchObject({ type: 'done', ok: true, message: 'Updated Claude Code to 2.1.310.' });
  });

  test('inspect mode refuses an update before it starts', async () => {
    const shinsa = await start(true);
    const refused = await post(shinsa, { program: 'claude' });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('inspect_read_only');
  });
});
