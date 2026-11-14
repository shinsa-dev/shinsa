import { afterEach, describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { AppUpdates } from '../../src/app-updates/service.ts';
import { disposeWebHandlers } from '../helpers/web.ts';
import { readFailure, startRoutes } from '../http/routes/harness.ts';

afterEach(disposeWebHandlers);

const REPORT = {
  version: '1.4.0',
  protocol: 1,
  channel: 'beta',
  update: { status: 'ready', version: '1.5.0-beta.1' },
};

function createAppUpdates(app: string | null) {
  return Effect.runSync(
    AppUpdates.use(Effect.succeed).pipe(
      Effect.provide(
        AppUpdates.layer({ app, engine: { version: '1.4.0', protocol: 1 }, open: () => Effect.void })
      )
    )
  );
}

describe('app updates routes', () => {
  test('the app reports, the page reads and asks, and the app gets the request with its next report', async () => {
    const { post, send } = startRoutes({ appUpdates: createAppUpdates('/Applications/Shinsa.app') });
    expect(await (await post('/api/app-updates/report', REPORT)).json()).toEqual({ requests: [] });
    const view = await (await send('/api/app-updates')).json();
    expect(view).toMatchObject({ source: 'app', running: true, app: REPORT, installing: null });
    const asked = await post('/api/app-updates/request', { kind: 'install' });
    expect(await asked.json()).toMatchObject({ installing: '1.5.0-beta.1' });
    expect(await (await post('/api/app-updates/report', REPORT)).json()).toEqual({
      requests: [{ kind: 'install' }],
    });
    expect(await (await post('/api/app-updates/open', {})).json()).toMatchObject({ source: 'app' });
  });

  test('refuses a request the app cannot take, and one that is not a request', async () => {
    const { post } = startRoutes({ appUpdates: createAppUpdates(null) });
    expect(await readFailure(await post('/api/app-updates/request', { kind: 'check' }))).toMatchObject({
      code: 'app_missing',
    });
    expect(await readFailure(await post('/api/app-updates/open', {}))).toMatchObject({ code: 'app_missing' });
    expect((await post('/api/app-updates/request', { kind: 'quit' })).status).toBe(400);
  });

  test('is not served where the engine has no app updates', async () => {
    const { post, send } = startRoutes();
    expect((await send('/api/app-updates')).status).toBe(404);
    expect((await post('/api/app-updates/report', REPORT)).status).toBe(404);
    expect((await post('/api/app-updates/request', { kind: 'check' })).status).toBe(404);
    expect((await post('/api/app-updates/open', {})).status).toBe(404);
  });
});
