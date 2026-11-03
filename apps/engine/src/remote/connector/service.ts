import { Context, Deferred, Effect, Fiber, Layer, type Redacted, Ref, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { Cloudflared } from '../cloudflared/service.ts';
import {
  CONNECT_TIMEOUT_MESSAGE,
  CONNECTED_PATTERN,
  ConnectTimeout,
  type OpenTunnel,
  OUTPUT_TAIL_CHARS,
  TunnelConnectFailed,
} from './schema.ts';

export class TunnelConnector extends Context.Service<TunnelConnector, { readonly open: OpenTunnel }>()(
  'shinsa/engine/remote/connector/TunnelConnector'
) {
  static readonly cloudflared = Layer.effect(
    TunnelConnector,
    Effect.gen(function* () {
      const cloudflared = yield* Cloudflared;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const timeout = yield* ConnectTimeout;
      const resolveLastLine = (text: string) => text.trim().split('\n').at(-1)?.trim() ?? '';
      const describeConnectTimeout = (text: string) => {
        const last = resolveLastLine(text);
        return last ? `${CONNECT_TIMEOUT_MESSAGE} It last printed: ${last}` : CONNECT_TIMEOUT_MESSAGE;
      };

      const open = Effect.fn('TunnelConnector.open')(function* (
        tunnelToken: Redacted.Redacted<string>,
        localUrl: string
      ) {
        const binary = yield* cloudflared.install.pipe(
          Effect.mapError((error) => new TunnelConnectFailed({ message: error.message }))
        );
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(binary, ['tunnel', '--no-autoupdate', 'run', '--url', localUrl], {
              env: { TUNNEL_TOKEN: tunnelToken },
              extendEnv: true,
              stdin: 'ignore',
              stdout: 'ignore',
              stderr: 'pipe',
            })
          )
          .pipe(Effect.mapError((error) => new TunnelConnectFailed({ message: error.message })));
        const tail = yield* Ref.make('');
        const connected = yield* Deferred.make<void>();
        const reading = yield* handle.stderr.pipe(
          Stream.decodeText(),
          Stream.runForEach((text) =>
            Ref.updateAndGet(tail, (before) => `${before}${text}`.slice(-OUTPUT_TAIL_CHARS)).pipe(
              Effect.flatMap((after) =>
                CONNECTED_PATTERN.test(after) ? Deferred.succeed(connected, undefined) : Effect.void
              )
            )
          ),
          Effect.ignore,
          Effect.forkScoped
        );
        const exitCode = handle.exitCode.pipe(Effect.orElseSucceed(() => -1));
        const stopped = Fiber.join(reading).pipe(
          Effect.andThen(exitCode),
          Effect.flatMap((code) =>
            Effect.flatMap(Ref.get(tail), (text) =>
              Effect.fail(
                new TunnelConnectFailed({
                  message: `cloudflared stopped with code ${code}: ${resolveLastLine(text)}`,
                })
              )
            )
          )
        );
        yield* Effect.raceFirst(Deferred.await(connected), stopped).pipe(
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () =>
              Effect.flatMap(Ref.get(tail), (text) =>
                Effect.fail(new TunnelConnectFailed({ message: describeConnectTimeout(text) }))
              ),
          })
        );
        return { exited: Effect.asVoid(exitCode) };
      });

      return TunnelConnector.of({ open });
    })
  );
}
