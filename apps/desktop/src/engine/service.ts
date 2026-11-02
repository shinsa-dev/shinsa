import { join } from 'node:path';
import { Clock, Context, Duration, Effect, Layer, Option, Ref } from 'effect';
import { Files } from '../files/service.ts';
import { DesktopHost } from '../host/service.ts';
import { Launchctl } from '../launchctl/service.ts';
import { LoginItems } from '../login-items/service.ts';
import { EngineServer } from '../server/service.ts';
import {
  isCrashing,
  isOnOtherPort,
  isSpawnRefused,
  isStandaloneAgent,
  listEngineVariables,
  parseLaunchdJob,
  resolveDataDir,
  resolveEngineProgram,
  resolveEngineTarget,
  resolveLaunchAgentPath,
  serializeEngineAgent,
} from './launchd.ts';
import {
  APP_ID,
  ENGINE_LOCK,
  ENGINE_LOG,
  EngineJobMissing,
  EngineNotStarted,
  type EngineOutcome,
  type EngineScreen,
  KICK_AFTER,
  LOAD_SCHEDULE,
  type Registration,
  START_SCHEDULE,
} from './schema.ts';
import { resolveLogTail, selectBusyPort } from './screen.ts';

export class EngineSupervisor extends Context.Service<
  EngineSupervisor,
  {
    ensure(onStarting: Effect.Effect<void>): Effect.Effect<EngineOutcome>;
    readonly restart: Effect.Effect<void>;
    readonly readDetails: Effect.Effect<string>;
  }
>()('shinsa/desktop/engine/EngineSupervisor') {
  static readonly layer = Layer.effect(
    EngineSupervisor,
    Effect.gen(function* () {
      const host = yield* DesktopHost;
      const files = yield* Files;
      const launchctl = yield* Launchctl;
      const loginItems = yield* LoginItems;
      const server = yield* EngineServer;
      const retiredOldService = yield* Ref.make(false);
      const target = resolveEngineTarget(host.uid);
      const plist = resolveLaunchAgentPath(host.home);
      const program = resolveEngineProgram(host.resourcesPath);
      const dataDir = resolveDataDir(host.env, host.home);
      const port = Number(new URL(server.origin).port);
      const readJob = launchctl
        .run(['print', target])
        .pipe(Effect.map((printed) => parseLaunchdJob(printed.output)));
      const isRefused = Effect.map(readJob, isSpawnRefused);
      const isLoaded = launchctl.run(['print', target]).pipe(Effect.map((printed) => printed.ok));
      const becomesLoaded = launchctl.run(['print', target]).pipe(
        Effect.filterOrFail(
          (printed) => printed.ok,
          () => new EngineJobMissing({ target })
        ),
        Effect.retry(LOAD_SCHEDULE),
        Effect.as(true),
        Effect.catchTag('EngineJobMissing', () => Effect.succeed(false))
      );
      const restart = Effect.asVoid(launchctl.run(['kickstart', '-k', target]));
      const readDataText = (file: string) => files.readText(join(dataDir, file));
      const readDetails = Effect.gen(function* () {
        const log = yield* readDataText(ENGINE_LOG);
        return [`Engine log: ${join(dataDir, ENGINE_LOG)}`, resolveLogTail(Option.getOrElse(log, () => ''))]
          .filter(Boolean)
          .join('\n\n');
      });
      const bootOut = Effect.fn('EngineSupervisor.bootOut')(function* (path: string, jobTarget: string) {
        if (!(yield* files.exists(path))) return;
        yield* launchctl.run(['bootout', jobTarget]);
        yield* files.remove(path);
      });
      const takeOverStandaloneEngine = Effect.gen(function* () {
        if (!host.packaged) return;
        const text = yield* files.readText(plist);
        if (Option.isNone(text) || !isStandaloneAgent(text.value, program)) return;
        yield* launchctl.run(['bootout', target]);
        yield* files.remove(plist);
      });
      const moveToThisPort = Effect.gen(function* () {
        if (!port) return;
        const job = yield* readJob;
        const lock = yield* readDataText(ENGINE_LOCK);
        if (isOnOtherPort(job, Option.getOrNull(lock), port)) yield* restart;
      });
      const retireOldService = Effect.gen(function* () {
        if (yield* Ref.getAndSet(retiredOldService, true)) return;
        yield* bootOut(resolveLaunchAgentPath(host.home, APP_ID), resolveEngineTarget(host.uid, APP_ID));
      });
      const installLaunchAgent = Effect.gen(function* () {
        const text = serializeEngineAgent({ path: program }, listEngineVariables(host.env));
        const current = yield* files.readText(plist);
        const loaded = yield* isLoaded;
        if (Option.getOrNull(current) === text && loaded) return;
        if (loaded) yield* launchctl.run(['bootout', target]);
        yield* files.writeText(plist, text);
        yield* launchctl.run(['bootstrap', `gui/${host.uid}`, plist]);
      }).pipe(
        Effect.catchTag('FileWriteFailed', (failure) =>
          Effect.logWarning('Could not write the engine’s launch agent').pipe(
            Effect.annotateLogs({ path: failure.path, error: failure.message })
          )
        )
      );
      const register = Effect.gen(function* () {
        const current = yield* loginItems.status;
        if (current === 'requires-approval') return current;
        if (current === 'enabled' && (yield* isLoaded)) return current;
        if (current === 'enabled') yield* loginItems.unregister;
        const registered = yield* loginItems.register;
        if (registered === 'requires-approval') return registered;
        if (registered === 'enabled' && (yield* becomesLoaded)) {
          yield* bootOut(plist, target);
          return registered;
        }
        if (registered === 'enabled') yield* loginItems.unregister;
        yield* installLaunchAgent;
        return 'enabled' satisfies Registration;
      });
      const waitForEngine = Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis;
        const kicked = yield* Ref.make(false);
        const attempt = Effect.gen(function* () {
          const health = yield* Effect.option(server.requestHealth);
          if (Option.isSome(health)) return health.value;
          const now = yield* Clock.currentTimeMillis;
          if (now - started > Duration.toMillis(KICK_AFTER) && !(yield* Ref.getAndSet(kicked, true))) {
            if (yield* isRefused) return yield* new EngineNotStarted({ retryable: false });
            yield* launchctl.run(['kickstart', target]);
          }
          return yield* new EngineNotStarted({ retryable: true });
        });
        return yield* attempt.pipe(Effect.retry(START_SCHEDULE), Effect.option);
      });
      const registerAgain = Effect.gen(function* () {
        if (!(yield* isRefused)) return Option.none();
        yield* loginItems.unregister;
        yield* bootOut(plist, target);
        const registered = yield* loginItems.register;
        if (registered !== 'enabled' || !(yield* becomesLoaded)) {
          yield* loginItems.unregister;
          yield* installLaunchAgent;
        }
        return yield* waitForEngine;
      });
      const describeFailure = Effect.gen(function* () {
        const job = yield* readJob;
        const detail = yield* readDetails;
        const busyPort = selectBusyPort(detail);
        if (busyPort !== null) return { kind: 'port', port: busyPort, detail } satisfies EngineScreen;
        if (isCrashing(job)) return { kind: 'crashing', detail } satisfies EngineScreen;
        return { kind: 'stopped', detail } satisfies EngineScreen;
      });
      const waiting = (screen: EngineScreen): EngineOutcome => ({ _tag: 'Waiting', screen });
      const ensure = Effect.fn('EngineSupervisor.ensure')(function* (onStarting: Effect.Effect<void>) {
        yield* takeOverStandaloneEngine;
        const running = yield* Effect.option(server.requestHealth);
        if (Option.isSome(running)) return { _tag: 'Running', health: running.value } satisfies EngineOutcome;
        if (!host.packaged) return waiting({ kind: 'dev' });
        yield* onStarting;
        yield* moveToThisPort;
        yield* retireOldService;
        if ((yield* register) === 'requires-approval') return waiting({ kind: 'approval' });
        const started = yield* waitForEngine;
        const health = Option.isSome(started) ? started : yield* registerAgain;
        if (Option.isSome(health)) return { _tag: 'Running', health: health.value } satisfies EngineOutcome;
        return waiting(yield* describeFailure);
      });
      return EngineSupervisor.of({
        ensure,
        restart: restart.pipe(Effect.withSpan('EngineSupervisor.restart')),
        readDetails: readDetails.pipe(Effect.withSpan('EngineSupervisor.readDetails')),
      });
    })
  );
}
