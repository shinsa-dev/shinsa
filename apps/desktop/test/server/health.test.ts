import { describe, expect, it } from 'bun:test';
import { Effect, Fiber, Option, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { HealthAnswer } from '../../src/server/schema.ts';
import { EngineServer } from '../../src/server/service.ts';
import { describeServer } from '../../src/server/url.ts';
import { answerJson, createWorld, type HttpAnswer, runDesktop } from '../support/desktop.ts';

function requestHealthWith(answer: HttpAnswer) {
  const world = createWorld({ answer: () => answer });
  return runDesktop(
    world,
    EngineServer.use((server) => Effect.option(server.requestHealth))
  ).then(Option.getOrNull);
}

function parseHealth(value: unknown) {
  return requestHealthWith(answerJson(value));
}

function parseHealthText(text: string) {
  return requestHealthWith({ status: 200, body: text });
}

describe('the engine’s health', () => {
  it('reads the version when the server reports one', async () => {
    expect(await parseHealth({ ok: true, seq: 4, problems: [], version: '0.4.0', pid: 12 })).toEqual({
      version: '0.4.0',
      working: 0,
      updating: false,
    });
  });

  it('answers without a version from a server that has none, or a log with damaged entries', async () => {
    expect(await parseHealth({ ok: false, seq: 4, problems: [{ seq: 1 }] })).toEqual({
      version: null,
      working: 0,
      updating: false,
    });
    expect(await parseHealth({ ok: true, version: '' })).toEqual({
      version: null,
      working: 0,
      updating: false,
    });
  });

  it('reads how many agents are working, and none from a count that is not one', async () => {
    expect(await parseHealth({ ok: true, working: 3, updating: false })).toEqual({
      version: null,
      working: 3,
      updating: false,
    });
    expect(await parseHealth({ ok: true, working: -1 })).toEqual({
      version: null,
      working: 0,
      updating: false,
    });
    expect(await parseHealth({ ok: true, working: 1.5 })).toEqual({
      version: null,
      working: 0,
      updating: false,
    });
    expect(await parseHealth({ ok: true, working: '2' })).toEqual({
      version: null,
      working: 0,
      updating: false,
    });
  });

  it('says when the engine waits for agents to hand over before it moves to a new version', async () => {
    expect(await parseHealth({ ok: true, working: 2, restart: 'idle' })).toEqual({
      version: null,
      working: 2,
      updating: true,
    });
  });

  it('refuses an answer that is not Shinsa’s', async () => {
    expect(await parseHealth(null)).toBeNull();
    expect(await parseHealth('ok')).toBeNull();
    expect(await parseHealth({ status: 'ok' })).toBeNull();
  });

  it('takes an engine on any update channel, since a canary is Shinsa too', async () => {
    expect(await parseHealth({ ok: true, version: '1.0.1-canary.2' })).toEqual({
      version: '1.0.1-canary.2',
      working: 0,
      updating: false,
    });
  });
});

describe('the health answer', () => {
  it('reads the health from the response body, and nothing from a body that is not JSON', async () => {
    expect(await parseHealthText('{"ok":true,"version":"0.4.0"}')).toEqual({
      version: '0.4.0',
      working: 0,
      updating: false,
    });
    expect(await parseHealthText('<html>')).toBeNull();
  });
});

describe('HealthAnswer', () => {
  it('writes a health back as an answer that reads the same', async () => {
    for (const health of [
      { version: '0.4.0', working: 2, updating: true },
      { version: null, working: 0, updating: false },
    ]) {
      expect(await parseHealth(Schema.encodeSync(HealthAnswer)(health))).toEqual(health);
    }
  });
});

describe('reaching the engine', () => {
  it('asks the engine at its own origin, and fails on a refused connection or another status', async () => {
    const world = createWorld({ answer: () => 'refuse' });
    const failure = await runDesktop(
      world,
      EngineServer.use((server) => Effect.flip(server.requestHealth))
    );
    expect(failure).toMatchObject({
      _tag: 'EngineUnreachable',
      origin: 'http://127.0.0.1:7446',
      reason: 'refused',
    });
    expect(world.requests).toEqual(['/api/health']);
    expect(await requestHealthWith({ status: 503, body: '{"ok":true}' })).toBeNull();
  });

  it('gives up on an engine that does not answer within the timeout', async () => {
    const world = createWorld({ answer: () => 'hang' });
    const failure = await runDesktop(
      world,
      EngineServer.use((server) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(Effect.flip(server.requestHealth));
          yield* TestClock.adjust('2 seconds');
          return yield* Fiber.join(fiber);
        })
      )
    );
    expect(failure.reason).toBe('timeout');
  });

  it('reads the port from config.json and SHINSA_URL over it', async () => {
    const files = new Map([['/Users/me/.config/shinsa/config.json', '{"port":5300}']]);
    const origin = EngineServer.use((server) => Effect.succeed(server.origin));
    expect(await runDesktop(createWorld({ files }), origin)).toBe('http://127.0.0.1:5300');
    expect(
      await runDesktop(createWorld({ files, env: { SHINSA_URL: 'http://localhost:9000/x' } }), origin)
    ).toBe('http://localhost:9000');
    expect(await runDesktop(createWorld({ files, packaged: false }), origin)).toBe('http://127.0.0.1:5181');
  });
});

describe('describeServer', () => {
  it('names the server the window shows', async () => {
    expect(describeServer('http://127.0.0.1:5180', { version: '0.4.0', working: 0, updating: false })).toBe(
      'Shinsa 0.4.0 at http://127.0.0.1:5180'
    );
    expect(describeServer('http://127.0.0.1:5180', { version: null, working: 0, updating: false })).toBe(
      'Shinsa at http://127.0.0.1:5180'
    );
    expect(describeServer('http://127.0.0.1:5180', null)).toBe('Shinsa at http://127.0.0.1:5180');
  });
});
