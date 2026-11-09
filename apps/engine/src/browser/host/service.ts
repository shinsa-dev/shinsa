import { join } from 'node:path';
import { Context, Effect, Exit, FileSystem, Layer, Option, Ref, Schema, Scope, Semaphore } from 'effect';
import { constant, constFalse } from 'effect/Function';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { EngineConfig } from '../../config/service.ts';
import { sendCdpCommand } from '../cdp/command.ts';
import {
  ACTIVE_PORT_FILE,
  type BrowserEndpoint,
  type BrowserMode,
  type BrowserProfile,
  BrowserHostSettings,
  BrowserUnavailable,
  DevToolsActivePort,
  HEADLESS_ARGS,
  LAUNCH_POLL,
  NOT_INSTALLED_MESSAGE,
  NOT_READY_MESSAGE,
  type RunningBrowser,
  SHARED_ARGS,
  SIGNING_IN_MESSAGE,
  type SignInUrl,
} from './schema.ts';

export class BrowserHost extends Context.Service<
  BrowserHost,
  {
    acquire(profile: BrowserProfile): Effect.Effect<BrowserEndpoint, BrowserUnavailable, Scope.Scope>;
    openWindow(profile: BrowserProfile, url: SignInUrl | null): Effect.Effect<void, BrowserUnavailable>;
    closeWindow(profile: BrowserProfile): Effect.Effect<void>;
    stop(profile: BrowserProfile): Effect.Effect<void>;
    remove(profile: BrowserProfile): Effect.Effect<void>;
    resolveMode(profile: BrowserProfile): Effect.Effect<BrowserMode>;
    resolveProfilePath(profile: BrowserProfile): string;
  }
>()('shinsa/engine/browser/host/BrowserHost') {
  static readonly layer = Layer.effect(
    BrowserHost,
    Effect.gen(function* () {
      const config = yield* EngineConfig;
      const settings = yield* BrowserHostSettings;
      const fs = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const layerScope = yield* Effect.scope;
      const root = config.browserDir;
      const running = yield* Ref.make<ReadonlyMap<BrowserProfile, RunningBrowser>>(new Map());
      const generations = yield* Ref.make(0);
      const lock = yield* Semaphore.make(1);
      const decodeActivePort = Schema.decodeUnknownEffect(DevToolsActivePort);
      const failLaunch = ({ message }: { readonly message: string }) =>
        new BrowserUnavailable({ reason: 'launch_failed', message });
      const notReady = failLaunch({ message: NOT_READY_MESSAGE });
      const resolveProfilePath = (profile: BrowserProfile) => join(root, profile);

      const write = (profile: BrowserProfile, next: RunningBrowser | null) =>
        Ref.update(running, (all) => {
          const copy = new Map(all);
          if (next) copy.set(profile, next);
          else copy.delete(profile);
          return copy;
        });

      const selectRunning = (profile: BrowserProfile) =>
        Effect.map(Ref.get(running), (all) => Option.fromNullishOr(all.get(profile)));

      const closeGracefully = Effect.fn('BrowserHost.closeGracefully')(function* (browser: RunningBrowser) {
        if (!browser.webSocketUrl) return;
        const closed = yield* Effect.exit(sendCdpCommand(browser.webSocketUrl, 'Browser.close'));
        const reached =
          Exit.isSuccess(closed) ||
          Exit.findErrorOption(closed).pipe(Option.exists((error) => error.reason !== 'unreachable'));
        if (!reached) return;
        yield* browser.exited.pipe(Effect.timeoutOption(settings.stopTimeout));
      });

      const stopRunning = Effect.fn('BrowserHost.stopRunning')(function* (profile: BrowserProfile) {
        const current = yield* selectRunning(profile);
        if (Option.isNone(current)) return;
        yield* write(profile, null);
        yield* closeGracefully(current.value);
        yield* Scope.close(current.value.scope, Exit.void);
      });

      const forgetExited = (profile: BrowserProfile, generation: number) =>
        lock.withPermit(
          Effect.flatMap(selectRunning(profile), (current) =>
            Option.isSome(current) && current.value.generation === generation
              ? stopRunning(profile)
              : Effect.void
          )
        );

      const findExecutable = Effect.gen(function* () {
        for (const executable of settings.executables) {
          if (yield* fs.exists(executable).pipe(Effect.orElseSucceed(constFalse))) return executable;
        }
        return yield* new BrowserUnavailable({ reason: 'not_installed', message: NOT_INSTALLED_MESSAGE });
      });

      const launch = Effect.fn('BrowserHost.launch')(function* (
        profile: BrowserProfile,
        mode: RunningBrowser['mode'],
        args: ReadonlyArray<string>
      ) {
        const executable = yield* findExecutable;
        const folder = resolveProfilePath(profile);
        const portFile = join(folder, ACTIVE_PORT_FILE);
        yield* fs.makeDirectory(folder, { recursive: true }).pipe(Effect.mapError(failLaunch));
        yield* Effect.ignore(fs.remove(portFile, { force: true }));
        const scope = yield* Scope.make();
        const closeScope = () => Scope.close(scope, Exit.void);
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(executable, [`--user-data-dir=${folder}`, ...SHARED_ARGS, ...args], {
              stdin: 'ignore',
              stdout: 'ignore',
              stderr: 'ignore',
              forceKillAfter: settings.stopTimeout,
            })
          )
          .pipe(Scope.provide(scope), Effect.mapError(failLaunch), Effect.onError(closeScope));
        const generation = yield* Ref.updateAndGet(generations, (count) => count + 1);
        const exited = handle.exitCode.pipe(Effect.orElseSucceed(constant(-1)));
        yield* exited.pipe(
          Effect.andThen(Effect.forkIn(forgetExited(profile, generation), layerScope)),
          Effect.forkIn(scope)
        );
        const webSocketUrl =
          mode === 'window'
            ? null
            : yield* fs.readFileString(portFile).pipe(
                Effect.flatMap(decodeActivePort),
                Effect.retry(LAUNCH_POLL),
                Effect.mapError(constant(notReady)),
                Effect.map(({ port, path: socketPath }) => `ws://127.0.0.1:${port}${socketPath}`),
                Effect.raceFirst(
                  Effect.flatMap(exited, (code) =>
                    Effect.fail(
                      failLaunch({ message: `Chrome stopped with code ${code} before it was ready.` })
                    )
                  )
                ),
                Effect.timeoutOrElse({
                  duration: settings.launchTimeout,
                  orElse: () => Effect.fail(notReady),
                }),
                Effect.onError(closeScope)
              );
        const started: RunningBrowser = { mode, generation, scope, exited, webSocketUrl, leases: 0, uses: 0 };
        yield* write(profile, started);
        return started;
      });

      const reveal = Effect.fn('BrowserHost.reveal')(function* (
        profile: BrowserProfile,
        url: SignInUrl | null
      ) {
        const executable = yield* findExecutable;
        const handOff = spawner
          .spawn(
            ChildProcess.make(
              executable,
              [`--user-data-dir=${resolveProfilePath(profile)}`, ...SHARED_ARGS, ...(url ? [url] : [])],
              { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', forceKillAfter: settings.stopTimeout }
            )
          )
          .pipe(
            Effect.flatMap((handle) => handle.exitCode),
            Effect.timeoutOption(settings.stopTimeout),
            Effect.ignore,
            Effect.scoped
          );
        yield* Effect.forkIn(handOff, layerScope);
      });

      const ensureHeadless = Effect.fn('BrowserHost.ensureHeadless')(function* (profile: BrowserProfile) {
        const current = yield* selectRunning(profile);
        if (Option.isSome(current) && current.value.mode === 'window') {
          return yield* new BrowserUnavailable({ reason: 'signing_in', message: SIGNING_IN_MESSAGE });
        }
        const headless = Option.isSome(current)
          ? current.value
          : yield* launch(profile, 'headless', HEADLESS_ARGS);
        const leased = { ...headless, leases: headless.leases + 1, uses: headless.uses + 1 };
        yield* write(profile, leased);
        return leased;
      });

      const stopWhenIdle = (profile: BrowserProfile, generation: number, uses: number) =>
        Effect.sleep(settings.idleAfter).pipe(
          Effect.andThen(
            lock.withPermit(
              Effect.flatMap(selectRunning(profile), (current) =>
                Option.isSome(current) &&
                current.value.generation === generation &&
                current.value.uses === uses &&
                current.value.leases === 0
                  ? stopRunning(profile)
                  : Effect.void
              )
            )
          )
        );

      const release = Effect.fn('BrowserHost.release')(function* (
        profile: BrowserProfile,
        generation: number
      ) {
        const current = yield* selectRunning(profile);
        if (Option.isNone(current) || current.value.generation !== generation) return;
        const leases = Math.max(0, current.value.leases - 1);
        yield* write(profile, { ...current.value, leases });
        if (leases === 0) {
          yield* Effect.forkIn(stopWhenIdle(profile, generation, current.value.uses), layerScope);
        }
      });

      const acquire = Effect.fn('BrowserHost.acquire')(function* (profile: BrowserProfile) {
        const leased = yield* lock.withPermit(ensureHeadless(profile));
        yield* Effect.addFinalizer(() => lock.withPermit(release(profile, leased.generation)));
        return { webSocketUrl: leased.webSocketUrl ?? '' };
      });

      const openWindow = Effect.fn('BrowserHost.openWindow')(function* (
        profile: BrowserProfile,
        url: SignInUrl | null
      ) {
        yield* lock.withPermit(
          Effect.gen(function* () {
            const current = yield* selectRunning(profile);
            if (Option.isSome(current) && current.value.mode === 'window') return yield* reveal(profile, url);
            yield* stopRunning(profile);
            yield* launch(profile, 'window', url ? [url] : []);
          })
        );
      });

      const closeWindow = Effect.fn('BrowserHost.closeWindow')(function* (profile: BrowserProfile) {
        yield* lock.withPermit(
          Effect.flatMap(selectRunning(profile), (current) =>
            Option.isSome(current) && current.value.mode === 'window' ? stopRunning(profile) : Effect.void
          )
        );
      });

      const stop = Effect.fn('BrowserHost.stop')(function* (profile: BrowserProfile) {
        yield* lock.withPermit(stopRunning(profile));
      });

      const remove = Effect.fn('BrowserHost.remove')(function* (profile: BrowserProfile) {
        yield* lock.withPermit(
          Effect.andThen(
            stopRunning(profile),
            Effect.ignore(fs.remove(resolveProfilePath(profile), { recursive: true, force: true }))
          )
        );
      });

      const resolveMode = (profile: BrowserProfile) =>
        Effect.map(selectRunning(profile), (current): BrowserMode =>
          Option.isSome(current) ? current.value.mode : 'stopped'
        );

      yield* Effect.addFinalizer(() =>
        Effect.flatMap(Ref.get(running), (all) =>
          Effect.forEach(all.values(), (browser) => Scope.close(browser.scope, Exit.void), {
            concurrency: 'unbounded',
            discard: true,
          })
        )
      );

      return BrowserHost.of({
        acquire,
        openWindow,
        closeWindow,
        stop,
        remove,
        resolveMode,
        resolveProfilePath,
      });
    })
  );
}
