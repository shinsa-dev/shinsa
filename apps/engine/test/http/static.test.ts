import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BunHttpPlatform, BunServices } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { serveStatic } from '../../src/http/static.ts';

const serve = (dir: string, path: string) =>
  Effect.runPromise(
    serveStatic(dir, path).pipe(
      Effect.map((response) => HttpServerResponse.toWeb(response)),
      Effect.provide(Layer.merge(BunServices.layer, BunHttpPlatform.layer))
    )
  );

const dirs: string[] = [];

function createWebDir() {
  const dir = mkdtempSync(join(tmpdir(), 'shinsa-static-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<html>app</html>');
  writeFileSync(join(dir, 'assets', 'index-a1b2.js'), 'run()');
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('serveStatic', () => {
  test('lets the browser keep a hashed asset for good, so a reload and the Mac app read it from disk', async () => {
    const response = await serve(createWebDir(), '/assets/index-a1b2.js');
    expect(await response.text()).toBe('run()');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  test('has the page and unhashed files checked again every time, so a new build shows at once', async () => {
    const dir = createWebDir();
    for (const path of ['/', '/tasks/SW-1', '/favicon.svg']) {
      expect((await serve(dir, path)).headers.get('cache-control')).toBe('no-cache');
    }
  });

  test('answers a folder or a missing file with the page, and says so when the app is not built', async () => {
    const dir = createWebDir();
    expect(await (await serve(dir, '/assets')).text()).toBe('<html>app</html>');
    rmSync(join(dir, 'index.html'));
    const missing = await serve(dir, '/tasks/SW-1');
    expect(missing.status).toBe(503);
    expect(await missing.text()).toContain('not built');
  });
});
