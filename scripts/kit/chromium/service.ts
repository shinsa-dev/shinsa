import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  Context,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  PubSub,
  Random,
  Ref,
  Schema,
  type Scope,
  Stream,
} from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import {
  CDP_PORT_RANGE,
  CdpCommandFailed,
  CdpConnectFailed,
  type CdpEvent,
  CdpEvaluateFailed,
  CdpMessageText,
  type CdpPage,
  type CdpParams,
  CHROMIUM_BUILD,
  CHROMIUM_IN_BUILD,
  ChromiumLaunchFailed,
  ChromiumLaunchTimeout,
  ChromiumNotFound,
  type ChromiumWindow,
  DESKTOP_WINDOW,
  EvaluateReply,
  EXPRESSION_POLL,
  HOVER,
  type Key,
  LAUNCH_POLL,
  LAUNCH_TIMEOUT,
  PageNotFound,
  PLAYWRIGHT_CACHE,
  type Point,
  STDERR_TAIL_CHARS,
  SYSTEM_CHROME,
  type Target,
  Targets,
  TargetsUnavailable,
  WAIT_TIMEOUT,
} from './schema.ts';

export class Chromium extends Context.Service<
  Chromium,
  {
    listTargets(port: number | string): Effect.Effect<ReadonlyArray<Target>, TargetsUnavailable>;
    connect(url: string): Effect.Effect<CdpPage, CdpConnectFailed, Scope.Scope>;
    launch(
      window?: ChromiumWindow
    ): Effect.Effect<
      CdpPage,
      ChromiumNotFound | ChromiumLaunchFailed | ChromiumLaunchTimeout | CdpConnectFailed,
      Scope.Scope
    >;
    attach(
      port: number | string,
      origin: string
    ): Effect.Effect<CdpPage, TargetsUnavailable | PageNotFound | CdpConnectFailed, Scope.Scope>;
    open(
      attachPort: string | null,
      origin: string
    ): Effect.Effect<
      CdpPage,
      | ChromiumNotFound
      | ChromiumLaunchFailed
      | ChromiumLaunchTimeout
      | TargetsUnavailable
      | PageNotFound
      | CdpConnectFailed,
      Scope.Scope
    >;
  }
>()('shinsa/scripts/kit/chromium/Chromium') {
  static readonly layer = Layer.effect(
    Chromium,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fs = yield* FileSystem.FileSystem;
      const http = yield* HttpClient.HttpClient;
      const chosenBinary = yield* Config.option(Config.String('SHINSA_PERF_CHROME'));
      const chosenPort = yield* Config.option(Config.Int('PERF_CDP_PORT'));
      const inCi = Option.isSome(yield* Config.option(Config.String('CI')));
      const decodeMessage = Schema.decodeUnknownOption(CdpMessageText);
      const decodeReply = Schema.decodeUnknownEffect(EvaluateReply);

      const listTargets = Effect.fn('Chromium.listTargets')(function* (port: number | string) {
        return yield* http.get(`http://127.0.0.1:${port}/json`).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Targets)),
          Effect.mapError(
            () =>
              new TargetsUnavailable({ message: `Nothing answers the debugging protocol on port ${port}.` })
          )
        );
      });

      const findBinary = Effect.gen(function* () {
        if (Option.isSome(chosenBinary)) return chosenBinary.value;
        const isPresent = (path: string) => fs.exists(path).pipe(Effect.orElseSucceed(() => false));
        const cache = join(homedir(), PLAYWRIGHT_CACHE);
        const builds = (yield* isPresent(cache))
          ? yield* fs
              .readDirectory(cache)
              .pipe(
                Effect.mapError(
                  (error) => new ChromiumNotFound({ message: `Reading ${cache} failed: ${error.message}` })
                )
              )
          : [];
        const candidates = [
          ...builds
            .filter((name) => CHROMIUM_BUILD.test(name))
            .sort()
            .reverse()
            .map((build) => join(cache, build, CHROMIUM_IN_BUILD)),
          SYSTEM_CHROME,
        ];
        const found = yield* Effect.findFirst(candidates, isPresent).pipe(Effect.map(Option.getOrUndefined));
        if (!found)
          return yield* new ChromiumNotFound({
            message: 'No Chromium found: set SHINSA_PERF_CHROME to a Chrome binary.',
          });
        return found;
      });

      const connect = Effect.fn('Chromium.connect')(function* (url: string) {
        const socket = yield* Effect.acquireRelease(
          Effect.callback<WebSocket, CdpConnectFailed>((resume) => {
            const opening = new WebSocket(url);
            opening.addEventListener('open', () => resume(Effect.succeed(opening)), { once: true });
            opening.addEventListener(
              'error',
              () => resume(Effect.fail(new CdpConnectFailed({ message: `Could not connect to ${url}.` }))),
              { once: true }
            );
            return Effect.sync(() => opening.close());
          }),
          (open) => Effect.sync(() => open.close())
        );
        const events = yield* Effect.acquireRelease(PubSub.unbounded<CdpEvent>(), PubSub.shutdown);
        const ids = yield* Ref.make(0);
        const pending = new Map<
          number,
          { method: string; reply: Deferred.Deferred<unknown, CdpCommandFailed> }
        >();
        socket.addEventListener('message', (event) => {
          const message = decodeMessage(String(event.data));
          if (Option.isNone(message)) return;
          const { id, method, params, result, error } = message.value;
          if (id === undefined) {
            PubSub.publishUnsafe(events, { method: method ?? '', params });
            return;
          }
          const waiting = pending.get(id);
          if (!waiting) return;
          pending.delete(id);
          Deferred.doneUnsafe(
            waiting.reply,
            error
              ? Effect.fail(new CdpCommandFailed({ method: waiting.method, message: error.message }))
              : Effect.succeed(result)
          );
        });
        socket.addEventListener('close', () => {
          for (const [id, waiting] of pending) {
            pending.delete(id);
            Deferred.doneUnsafe(
              waiting.reply,
              Effect.fail(
                new CdpCommandFailed({ method: waiting.method, message: 'The page closed its connection.' })
              )
            );
          }
        });

        const send = Effect.fn('CdpPage.send')(function* (method: string, params: CdpParams = {}) {
          const id = yield* Ref.updateAndGet(ids, (last) => last + 1);
          const reply = yield* Deferred.make<unknown, CdpCommandFailed>();
          pending.set(id, { method, reply });
          yield* Effect.try({
            try: () => socket.send(JSON.stringify({ id, method, params })),
            catch: () => new CdpCommandFailed({ method, message: 'The page connection is closed.' }),
          });
          return yield* Deferred.await(reply);
        });

        const request = Effect.fn('CdpPage.request')(function* <A>(
          method: string,
          params: CdpParams,
          shape: Schema.Decoder<A>
        ) {
          const result = yield* send(method, params);
          return yield* Schema.decodeUnknownEffect(shape)(result).pipe(
            Effect.mapError((issue) => new CdpCommandFailed({ method, message: issue.message }))
          );
        });

        const evaluate = Effect.fn('CdpPage.evaluate')(function* <A>(
          expression: string,
          shape: Schema.Decoder<A>
        ) {
          const raw = yield* send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
          });
          const reply = yield* decodeReply(raw).pipe(
            Effect.mapError((issue) => new CdpEvaluateFailed({ message: issue.message }))
          );
          if (reply.exceptionDetails)
            return yield* new CdpEvaluateFailed({
              message:
                reply.exceptionDetails.exception?.description ??
                reply.exceptionDetails.text ??
                'evaluate failed',
            });
          return yield* Schema.decodeUnknownEffect(shape)(reply.result.value).pipe(
            Effect.mapError((issue) => new CdpEvaluateFailed({ message: issue.message }))
          );
        });

        const waitForExpression = Effect.fn('CdpPage.waitForExpression')(function* (
          expression: string,
          timeout = WAIT_TIMEOUT
        ) {
          return yield* evaluate(
            `(() => { try { return !!(${expression}); } catch { return false; } })()`,
            Schema.Boolean
          ).pipe(
            Effect.repeat({ schedule: EXPRESSION_POLL, until: (ready) => ready }),
            Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.succeed(false) })
          );
        });

        const pressKey = Effect.fn('CdpPage.pressKey')(function* (key: Key) {
          const base = {
            key: key.key,
            code: key.code,
            windowsVirtualKeyCode: key.keyCode,
            modifiers: key.modifiers ?? 0,
          };
          yield* send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
          yield* send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
        });

        const clickPoint = Effect.fn('CdpPage.clickPoint')(function* (point: Point, hover = HOVER) {
          yield* send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
          yield* Effect.sleep(hover);
          for (const type of ['mousePressed', 'mouseReleased'])
            yield* send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
        });

        const subscribe = Effect.fn('CdpPage.subscribe')(function* (...methods: string[]) {
          const subscription = yield* PubSub.subscribe(events);
          return Stream.fromSubscription(subscription).pipe(
            Stream.filter((event) => methods.length === 0 || methods.includes(event.method))
          );
        });

        const page: CdpPage = { send, request, evaluate, waitForExpression, pressKey, clickPoint, subscribe };
        return page;
      });

      const launch = Effect.fn('Chromium.launch')(function* (window: ChromiumWindow = DESKTOP_WINDOW) {
        const binary = yield* findBinary;
        const port = Option.isSome(chosenPort)
          ? chosenPort.value
          : yield* Random.nextIntBetween(CDP_PORT_RANGE.from, CDP_PORT_RANGE.to);
        const profile = yield* fs
          .makeTempDirectoryScoped({ prefix: 'shinsa-perf-' })
          .pipe(
            Effect.mapError(
              (error) =>
                new ChromiumLaunchFailed({ message: `Making a Chromium profile failed: ${error.message}` })
            )
          );
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(
              binary,
              [
                '--headless=new',
                `--remote-debugging-port=${port}`,
                `--user-data-dir=${profile}`,
                `--window-size=${window.width},${window.height}`,
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                ...(inCi ? ['--no-sandbox'] : []),
                'about:blank',
              ],
              { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' }
            )
          )
          .pipe(Effect.mapError((error) => new ChromiumLaunchFailed({ message: error.message })));
        const tail = yield* Ref.make('');
        yield* handle.stderr.pipe(
          Stream.decodeText(),
          Stream.runForEach((text) =>
            Ref.update(tail, (before) => `${before}${text}`.slice(-STDERR_TAIL_CHARS))
          ),
          Effect.ignore,
          Effect.forkScoped
        );
        const target = yield* listTargets(port).pipe(
          Effect.map((targets) => targets.find((entry) => entry.type === 'page')),
          Effect.orElseSucceed(() => undefined),
          Effect.repeat({ schedule: LAUNCH_POLL, until: (found) => found !== undefined }),
          Effect.timeoutOrElse({
            duration: LAUNCH_TIMEOUT,
            orElse: () =>
              Effect.flatMap(Ref.get(tail), (output) =>
                Effect.fail(
                  new ChromiumLaunchTimeout({
                    message: output.trim()
                      ? `Chromium did not open a page within 30 seconds:\n${output.trim()}`
                      : 'Chromium did not open a page within 30 seconds.',
                  })
                )
              ),
          })
        );
        if (!target) return yield* new ChromiumLaunchTimeout({ message: 'Chromium did not open a page.' });
        return yield* connect(target.webSocketDebuggerUrl);
      });

      const attach = Effect.fn('Chromium.attach')(function* (port: number | string, origin: string) {
        const targets = yield* listTargets(port);
        const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith(origin));
        if (!target) return yield* new PageNotFound({ message: `No page on ${origin} at port ${port}.` });
        return yield* connect(target.webSocketDebuggerUrl);
      });

      const open = (attachPort: string | null, origin: string) =>
        attachPort ? attach(attachPort, origin) : launch(DESKTOP_WINDOW);

      return Chromium.of({ listTargets, connect, launch, attach, open });
    })
  );
}
