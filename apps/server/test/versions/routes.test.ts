import { describe, expect, spyOn, test } from 'bun:test';
import type { UpdateOutcome, UpdateStreamLine, VersionsSnapshot } from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { Versions } from '../../src/versions/index.ts';
import { createVersionRoutes, UPDATE_STREAM_TYPE } from '../../src/versions/routes.ts';

const PASSED = { ok: true, code: 0, stdout: '', stderr: '', timedOut: false };

function createRoutes(run = () => Promise.resolve(PASSED)) {
  const installed = { version: '2.1.287' };
  const versions = new Versions({
    locate: (program) => ({ path: `/opt/bin/${program}`, override: null }),
    readVersion: () => Promise.resolve(installed.version),
    minimum: () => '2.1.280',
    sdk: () => ({ version: '0.3.280', claudeCodeVersion: '2.1.280' }),
    latest: () => Promise.resolve('2.1.310'),
    run: (_updater, onLine) => {
      onLine('Checking for updates');
      installed.version = '2.1.310';
      return run();
    },
  });
  const routes = createVersionRoutes(versions);
  return (method: 'GET' | 'POST', path: string, body?: unknown, accept?: string) => {
    const route = routes.find((entry) => entry.method === method && entry.pattern.test(path));
    if (!route) throw new Error(`No route for ${method} ${path}.`);
    const request = new Request(`http://127.0.0.1${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(accept ? { accept } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return route.respond(route.pattern.exec(path) as RegExpExecArray, request);
  };
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
    const lines = readLines(await streamed.text());
    expect(lines[0]).toEqual({ type: 'output', line: 'Checking for updates' });
    expect(lines[1]).toMatchObject({ type: 'done', ok: true, message: 'Codex is up to date.' });
  });

  test('a refused update throws before anything streams; a broken one ends the stream with an error', async () => {
    await expect(
      createRoutes()('POST', '/api/versions/update', { program: 'gh' }, UPDATE_STREAM_TYPE)
    ).rejects.toThrow('Name the program to update: claude or codex.');
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const broken = await createRoutes(() => Promise.reject(new Error('spawn failed')))(
      'POST',
      '/api/versions/update',
      { program: 'claude' },
      UPDATE_STREAM_TYPE
    );
    await expect(broken.text()).rejects.toThrow('spawn failed');
    expect(warn).toHaveBeenCalledWith('[Versions] The update stream failed', { error: 'spawn failed' });
    warn.mockRestore();
  });
});
