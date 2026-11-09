import { describe, expect, test } from 'bun:test';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { sendCdpCommand } from '../../src/browser/cdp/command.ts';
import { CDP_TIMEOUT, CDP_TIMEOUT_MESSAGE, CDP_UNREACHABLE_MESSAGE } from '../../src/browser/cdp/schema.ts';

function startSilentCdp(reply: ((id: number) => unknown) | null) {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return undefined;
      return new Response('', { status: 400 });
    },
    websocket: {
      message: (socket, message) => {
        const { id } = JSON.parse(String(message)) as { id: number };
        if (reply) socket.send(JSON.stringify(reply(id)));
        else socket.close(1000, 'bye');
      },
    },
  });
}

describe('one command to Chrome over its debugging socket', () => {
  test('answers with the result Chrome sends back', async () => {
    const server = startSilentCdp((id) => ({ id, result: { ok: 1 } }));
    const result = await Effect.runPromise(
      sendCdpCommand(`ws://127.0.0.1:${server.port}/`, 'Target.getTargets')
    );
    void server.stop(true);
    expect(result).toEqual({ ok: 1 });
  });

  test('fails with refused when Chrome answers with an error', async () => {
    const server = startSilentCdp((id) => ({ id, error: { message: 'No such method' } }));
    const error = await Effect.runPromise(
      Effect.flip(Effect.asVoid(sendCdpCommand(`ws://127.0.0.1:${server.port}/`, 'Nope.nope')))
    );
    void server.stop(true);
    expect(error).toMatchObject({
      _tag: 'CdpFailed',
      method: 'Nope.nope',
      reason: 'refused',
      message: 'No such method',
    });
  });

  test('tells a closed connection from one that never opened', async () => {
    const server = startSilentCdp(null);
    const closed = await Effect.runPromise(
      Effect.flip(Effect.asVoid(sendCdpCommand(`ws://127.0.0.1:${server.port}/`, 'Browser.close')))
    );
    const port = server.port;
    void server.stop(true);
    const unreachable = await Effect.runPromise(
      Effect.flip(Effect.asVoid(sendCdpCommand(`ws://127.0.0.1:${port}/`, 'Browser.close')))
    );
    expect(closed).toMatchObject({ reason: 'closed' });
    expect(unreachable).toMatchObject({ reason: 'unreachable', message: CDP_UNREACHABLE_MESSAGE });
  });

  test('closes its socket when the caller stops waiting', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request, bunServer) {
        if (bunServer.upgrade(request)) return undefined;
        return new Response('', { status: 400 });
      },
      websocket: { message: () => undefined, close: () => undefined },
    });
    const outcome = await Effect.runPromise(
      sendCdpCommand(`ws://127.0.0.1:${server.port}/`, 'Target.getTargets').pipe(
        Effect.timeoutOption('200 millis')
      )
    );
    expect(outcome._tag).toBe('None');
    await Bun.sleep(50);
    expect(server.pendingWebSockets).toBe(0);
    void server.stop(true);
  });

  test('fails with timeout when Chrome never answers', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request, bunServer) {
        if (bunServer.upgrade(request)) return undefined;
        return new Response('', { status: 400 });
      },
      websocket: { message: () => undefined },
    });
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.flip(Effect.asVoid(sendCdpCommand(`ws://127.0.0.1:${server.port}/`, 'Target.getTargets')))
        );
        yield* TestClock.adjust(CDP_TIMEOUT);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    void server.stop(true);
    expect(error).toMatchObject({ reason: 'timeout', message: CDP_TIMEOUT_MESSAGE });
  });
});
