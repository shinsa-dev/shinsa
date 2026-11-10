import { BunRuntime } from '@effect/platform-bun';
import { Config, Console, Effect, Ref, Schedule } from 'effect';
import { SandboxFailed } from './schema.ts';

const TICK = Schedule.spaced('1 second');

const program = Effect.gen(function* () {
  const service = yield* Config.String('SANDBOX_SERVICE').pipe(Config.withDefault('web'));
  const project = yield* Config.String('SANDBOX_PROJECT').pipe(Config.withDefault('Sandbox'));
  const port = yield* Config.Number('PORT').pipe(Config.withDefault(0));
  const page = `<!doctype html><meta charset="utf-8"><title>${service} · ${project}</title>
<body style="font:15px system-ui;margin:40px;max-width:560px">
<h1 style="font-size:18px">${service} · ${project}</h1>
<p>A seeded dev server: the ${service} service of the ${project} project.</p>
<p>Host it saw: <code id="host"></code></p>
<p>Live updates: <strong id="ticks">connecting…</strong></p>
<script>
document.getElementById('host').textContent = HOST_SEEN;
const socket = new WebSocket(location.origin.replace('http', 'ws') + '/live');
socket.onmessage = (event) => { document.getElementById('ticks').textContent = event.data; };
socket.onclose = () => { document.getElementById('ticks').textContent = 'disconnected'; };
</script></body>`;
  const server = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.serve({
          port,
          hostname: 'localhost',
          fetch(request, bunServer) {
            if (new URL(request.url).pathname === '/live' && bunServer.upgrade(request)) return undefined;
            const host = JSON.stringify(request.headers.get('host') ?? '');
            return new Response(page.replace('HOST_SEEN', host), {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            });
          },
          websocket: {
            open(socket) {
              socket.subscribe('ticks');
            },
            message() {},
          },
        }),
      catch: (error) =>
        new SandboxFailed({ message: `Serving the ${service} service failed: ${String(error)}` }),
    }),
    (listening) => Effect.promise(() => listening.stop(true))
  );
  yield* Console.info(`The ${service} service of ${project} on http://localhost:${server.port}/`);
  const ticks = yield* Ref.make(0);
  return yield* Ref.updateAndGet(ticks, (count) => count + 1).pipe(
    Effect.map((count) => server.publish('ticks', String(count))),
    Effect.schedule(TICK)
  );
});

program.pipe(Effect.scoped, BunRuntime.runMain);
