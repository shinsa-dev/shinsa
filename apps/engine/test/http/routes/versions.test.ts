import { afterEach, describe, expect, test } from 'bun:test';
import type { UpdateOutcome, UpdateStreamLine, VersionsSnapshot } from '@shinsa/core';
import { Effect } from 'effect';
import { UPDATE_STREAM_TYPE } from '../../../src/http/routes/versions/schema.ts';
import type { CommandResult } from '../../../src/shell/schema.ts';
import { VersionsCallFailed } from '../../../src/versions/schema.ts';
import { disposeWebHandlers, recordedLogs } from '../../helpers/web.ts';
import { buildFakeVersions } from '../../versions/fakes.ts';
import { readFailure, startRoutes } from './harness.ts';

afterEach(disposeWebHandlers);

const PASSED = { ok: true, code: 0, stdout: '', stderr: '', timedOut: false };

function createRoutes(run: Effect.Effect<CommandResult, VersionsCallFailed> = Effect.succeed(PASSED)) {
  const installed = { version: '2.1.287' };
  const versions = buildFakeVersions({
    readVersion: () => installed.version,
    latest: () => Effect.succeed('2.1.310'),
    run: (_updater, onLine) =>
      Effect.suspend(() => {
        onLine('Checking for updates');
        installed.version = '2.1.310';
        return run;
      }),
  });
  const routes = startRoutes({ versions });
  return (method: 'GET' | 'POST', path: string, body?: unknown, accept?: string) =>
    routes.send(path, {
      method,
      headers: { 'content-type': 'application/json', ...(accept ? { accept } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

function readLines(text: string) {
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as UpdateStreamLine);
}

describe('the versions routes', () => {
  test('GET /api/versions and POST /api/versions/refresh answer the snapshot', async () => {
    const request = createRoutes();
    const snapshot = (await (await request('GET', '/api/versions')).json()) as VersionsSnapshot;
    expect(snapshot.programs.map((program) => program.status)).toEqual([
      'update_available',
      'update_available',
    ]);
    const refreshed = (await (await request('POST', '/api/versions/refresh', {})).json()) as VersionsSnapshot;
    expect(refreshed.sdk.latest).toBe('2.1.310');
  });

  test('an update answers its outcome as JSON, or streams its output when asked for lines', async () => {
    const request = createRoutes();
    const outcome = (await (
      await request('POST', '/api/versions/update', { program: 'claude' })
    ).json()) as UpdateOutcome;
    expect(outcome).toMatchObject({ ok: true, message: 'Updated Claude Code to 2.1.310.' });
    const streamed = await request('POST', '/api/versions/update', { program: 'codex' }, UPDATE_STREAM_TYPE);
    expect(streamed.headers.get('content-type')).toBe(UPDATE_STREAM_TYPE);
    expect(streamed.headers.get('cache-control')).toBe('no-store');
    const lines = readLines(await streamed.text());
    expect(lines[0]).toEqual({ type: 'output', line: 'Checking for updates' });
    expect(lines[1]).toMatchObject({ type: 'done', ok: true, message: 'Codex is up to date.' });
  });

  test('a refused update fails before anything streams; a broken one ends the stream with an error', async () => {
    const refused = await createRoutes()(
      'POST',
      '/api/versions/update',
      { program: 'gh' },
      UPDATE_STREAM_TYPE
    );
    expect(await readFailure(refused)).toMatchObject({ status: 400, message: 'Update claude or codex.' });
    const broken = await createRoutes(Effect.fail(new VersionsCallFailed({ message: 'spawn failed' })))(
      'POST',
      '/api/versions/update',
      { program: 'claude' },
      UPDATE_STREAM_TYPE
    );
    await expect(broken.text()).rejects.toThrow();
    expect(recordedLogs).toContainEqual({
      message: '[Versions] The update stream failed',
      fields: { error: 'spawn failed' },
    });
  });

  test('without versions the routes are not found', async () => {
    const routes = startRoutes();
    expect((await routes.send('/api/versions')).status).toBe(404);
  });
});
