import { afterEach, describe, expect, test } from 'bun:test';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { Context, Effect, Exit, Layer, ManagedRuntime, Scope } from 'effect';
import { BrowserHostSettings } from '../../src/browser/host/schema.ts';
import { BrowserProxy } from '../../src/browser/proxy/service.ts';
import { EngineServer } from '../../src/http/server/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { EngineLayer } from '../../src/serve/layers.ts';
import { createTestConfig } from '../helpers/index.ts';
import { until } from '../helpers/until.ts';
import { type FakeCdp, startFakeCdp } from './cdp.ts';
import { createFakeChrome, SHINSA } from './harness.ts';

const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

const LAN_ADDRESS = Object.values(networkInterfaces())
  .flat()
  .find((address) => address?.family === 'IPv4' && !address.internal)?.address;

async function startEngine(hostname = '127.0.0.1') {
  const chrome = createFakeChrome();
  const cdp: FakeCdp = startFakeCdp();
  chrome.listenOn(cdp.port);
  const settings = Layer.succeed(BrowserHostSettings, {
    executables: [chrome.path],
    idleAfter: '1 hour',
    launchTimeout: '5 seconds',
    stopTimeout: '2 seconds',
  });
  const runtime = ManagedRuntime.make(
    EngineLayer(createTestConfig(chrome.home, { port: 0, hostname }), {}, Effect.void).pipe(
      Layer.provide(settings),
      Layer.provideMerge(JsonLogger)
    )
  );
  const context = await runtime.context();
  const run = await runtime.runPromise(Scope.make());
  const endpoint = await runtime.runPromise(
    Context.get(context, BrowserProxy).issue(SHINSA).pipe(Scope.provide(run))
  );
  stops.push(async () => {
    cdp.stop();
    await runtime.dispose();
  });
  return {
    cdp,
    chrome,
    endpoint,
    url: Context.get(context, EngineServer).url,
    endRun: () => runtime.runPromise(Scope.close(run, Exit.void)),
  };
}

function connect(endpoint: string) {
  const socket = new WebSocket(endpoint);
  const messages: string[] = [];
  const closed: { code: number; reason: string }[] = [];
  socket.onmessage = (event) => messages.push(String(event.data));
  socket.onclose = (event) => closed.push({ code: event.code, reason: event.reason });
  const opened = new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('The browser socket did not open.'));
  });
  return { socket, messages, closed, opened };
}

describe("the engine's browser route", () => {
  test("relays an agent's run key to its project's Chrome and ends with the run", async () => {
    const engine = await startEngine();
    const agent = connect(engine.endpoint);
    await agent.opened;
    agent.socket.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }));
    agent.socket.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
    await until('both answers', () => agent.messages.length >= 2);
    expect(engine.cdp.received.map((text) => JSON.parse(text).method)).toEqual(['Target.getTargets']);
    expect(engine.chrome.launches()).toHaveLength(1);
    expect(engine.chrome.launches()[0]).toContain(
      `--user-data-dir=${join(engine.chrome.home, 'data', 'browser', SHINSA)}`
    );
    await engine.endRun();
    await until('the socket to close', () => agent.closed.length > 0);
    expect(agent.closed[0]?.code).toBe(1008);
  });

  test('refuses a key it did not issue, another site and a request that is not a socket', async () => {
    const engine = await startEngine();
    const http = engine.endpoint.replace(/^ws/, 'http');
    const unknown = await fetch(`${engine.url}/browser/cdp/${'x'.repeat(43)}`);
    expect(unknown.status).toBe(401);
    const crossSite = await fetch(http, { headers: { origin: 'https://evil.example' } });
    expect(crossSite.status).toBe(403);
    const plain = await fetch(http);
    expect(plain.status).toBe(400);
    const agent = connect(engine.endpoint);
    await agent.opened;
    agent.socket.close();
  });

  test.skipIf(!LAN_ADDRESS)('refuses a socket that does not come from this Mac', async () => {
    const engine = await startEngine(LAN_ADDRESS);
    const key = engine.endpoint.split('/').at(-1);
    const response = await fetch(`http://${LAN_ADDRESS}:${new URL(engine.url).port}/browser/cdp/${key}`);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'local_only' } });
  });

  test('says why when Chrome is missing', async () => {
    const engine = await startEngine();
    engine.chrome.fail();
    const response = await fetch(engine.endpoint.replace(/^ws/, 'http'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'browser_unavailable' } });
  });
});
