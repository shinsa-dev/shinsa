import { describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { AppUpdatesLayer } from '../../src/app-updates/layers.ts';
import { openAppInBackground, resolveEngineApp } from '../../src/app-updates/open.ts';
import { AppUpdates } from '../../src/app-updates/service.ts';
import type { CommandRequest, CommandResult } from '../../src/shell/schema.ts';
import { Shell } from '../../src/shell/service.ts';
import { createTempDir } from '../helpers/index.ts';

function createShell(result: CommandResult) {
  const requests: CommandRequest[] = [];
  const layer = Layer.succeed(
    Shell,
    Shell.of({
      run: (request) =>
        Effect.sync(() => {
          requests.push(request);
          return result;
        }),
      stopTree: () => Effect.void,
    })
  );
  return { requests, layer };
}

function openWith(result: CommandResult) {
  const { requests, layer: shell } = createShell(result);
  const outcome = Effect.runPromise(
    openAppInBackground('/Applications/Shinsa.app').pipe(Effect.result, Effect.provide(shell))
  );
  return { requests, outcome };
}

function createEngineLink() {
  const root = createTempDir();
  const bin = join(root, 'Shinsa.app/Contents/Resources/engine/bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'shinsa'), '');
  symlinkSync(join(bin, 'shinsa'), join(root, 'shinsa'));
  return join(root, 'shinsa');
}

describe('opening the app', () => {
  test('the served layer opens the app that carries the engine through the shell', async () => {
    const shell = createShell({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false });
    const answer = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* AppUpdates).open;
      }).pipe(
        Effect.provide(
          AppUpdatesLayer({ version: '1.4.0', protocol: 1 }, createEngineLink()).pipe(
            Layer.provide(Layer.merge(shell.layer, BunFileSystem.layer))
          )
        )
      )
    );
    expect(answer.source).toBe('app');
    expect(shell.requests[0]?.argv.slice(0, 2)).toEqual(['open', '-g']);
    expect(shell.requests[0]?.argv[2]?.endsWith('/Shinsa.app')).toBe(true);
  });

  test('finds the app through the link the engine runs from', async () => {
    const root = createTempDir();
    const bin = join(root, 'Shinsa.app/Contents/Resources/engine/bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'shinsa'), '');
    symlinkSync(join(bin, 'shinsa'), join(root, 'shinsa'));
    const app = await Effect.runPromise(
      resolveEngineApp(join(root, 'shinsa')).pipe(Effect.provide(BunFileSystem.layer))
    );
    expect(app?.endsWith('/Shinsa.app')).toBe(true);
    expect(
      await Effect.runPromise(
        resolveEngineApp(join(root, 'missing')).pipe(Effect.provide(BunFileSystem.layer))
      )
    ).toBeNull();
  });

  test('opens it in the background, and says why when macOS refuses', async () => {
    const opened = openWith({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false });
    expect((await opened.outcome)._tag).toBe('Success');
    expect(opened.requests[0]).toMatchObject({
      argv: ['open', '-g', '/Applications/Shinsa.app'],
      cwd: '/Applications',
    });
    const refused = await openWith({
      ok: false,
      code: 1,
      stdout: '',
      stderr: 'LSOpen failed\n',
      timedOut: false,
    }).outcome;
    expect(refused).toMatchObject({ _tag: 'Failure', failure: { message: 'LSOpen failed' } });
    const silent = await openWith({ ok: false, code: 1, stdout: '', stderr: '', timedOut: false }).outcome;
    expect(silent).toMatchObject({ _tag: 'Failure', failure: { message: 'Shinsa for Mac did not open.' } });
  });
});
