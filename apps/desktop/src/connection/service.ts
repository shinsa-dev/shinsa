import { Context, Effect, Layer, Option, Ref, Stream } from 'effect';
import { EngineActions } from '../engine-actions/service.ts';
import { type EngineAction, type EngineScreen, LOGIN_ITEMS_URL, PRIVACY_URL } from '../engine/schema.ts';
import { describeEngineScreen } from '../engine/screen.ts';
import { EngineSupervisor } from '../engine/service.ts';
import { FirstHealth } from '../first-health/service.ts';
import { AppMenu } from '../menu/service.ts';
import type { ServerHealth } from '../server/schema.ts';
import { EngineServer } from '../server/service.ts';
import { DesktopShell } from '../shell/service.ts';
import { LOCAL_SOURCE } from '../source/schema.ts';
import { EngineSource } from '../source/service.ts';
import { StatusTray } from '../tray/service.ts';
import { AppWindow } from '../window/service.ts';
import { type ConnectStep, MISSES_BEFORE_WAITING, RETRY_SCHEDULE, WATCH_SCHEDULE } from './schema.ts';

export class Connection extends Context.Service<Connection, { readonly start: Effect.Effect<void> }>()(
  'shinsa/desktop/connection/Connection'
) {
  static readonly layer = Layer.effect(
    Connection,
    Effect.gen(function* () {
      const server = yield* EngineServer;
      const firstHealth = yield* FirstHealth;
      const engine = yield* EngineSupervisor;
      const window = yield* AppWindow;
      const tray = yield* StatusTray;
      const menu = yield* AppMenu;
      const shell = yield* DesktopShell;
      const actions = yield* EngineActions;
      const source = yield* EngineSource;
      const viewer = source.started.kind === 'cloud';
      const scope = yield* Effect.scope;
      const connecting = yield* Ref.make(false);
      const usedFirstHealth = yield* Ref.make(false);
      const misses = yield* Ref.make(0);
      const shownScreen = yield* Ref.make('');
      const later = (effect: Effect.Effect<unknown>) => Effect.asVoid(Effect.forkIn(effect, scope));
      const requestHealth = Effect.option(server.requestHealth);
      const refreshTray = Effect.fn('Connection.refreshTray')(function* (
        health: Option.Option<ServerHealth>
      ) {
        if (Option.isNone(health) || viewer) return yield* tray.update(Option.getOrNull(health), null);
        const queue = yield* Effect.option(server.requestQueue);
        yield* tray.update(health.value, Option.getOrNull(queue));
      });
      const showApp = Effect.fn('Connection.showApp')(function* (health: ServerHealth) {
        yield* later(refreshTray(Option.some(health)));
        yield* menu.showServer(health);
        yield* Ref.set(misses, 0);
        yield* Ref.set(shownScreen, '');
        yield* later(window.showServerPage);
      });
      const showScreen = Effect.fn('Connection.showScreen')(function* (screen: EngineScreen) {
        const view = describeEngineScreen(screen);
        const key = JSON.stringify(view);
        if ((yield* window.page) === 'waiting' && (yield* Ref.get(shownScreen)) === key) return;
        yield* Ref.set(shownScreen, key);
        yield* shell.setBadge('');
        yield* window.showWaiting(view);
      });
      const reachCloud = Effect.gen(function* () {
        const health = yield* requestHealth;
        if (Option.isSome(health)) return yield* showApp(health.value);
        yield* showScreen({ kind: 'cloud' });
      });
      const attempt = Effect.gen(function* () {
        const outcome = yield* engine.ensure(showScreen({ kind: 'starting' }));
        if (outcome._tag === 'Running') {
          yield* showApp(outcome.health);
          return 'done' satisfies ConnectStep;
        }
        yield* showScreen(outcome.screen);
        const waitsForYou = outcome.screen.kind === 'dev' || outcome.screen.kind === 'approval';
        return (waitsForYou ? 'again' : 'done') satisfies ConnectStep;
      });
      const reach = Effect.gen(function* () {
        const found = (yield* Ref.getAndSet(usedFirstHealth, true))
          ? yield* requestHealth
          : yield* firstHealth.answer;
        if (Option.isSome(found)) return yield* showApp(found.value);
        if (viewer) return yield* reachCloud;
        yield* Effect.repeat(attempt, RETRY_SCHEDULE);
      });
      const connect = Effect.gen(function* () {
        if (yield* Ref.getAndSet(connecting, true)) return;
        yield* reach.pipe(Effect.ensuring(Ref.set(connecting, false)));
      }).pipe(Effect.withSpan('Connection.connect'));
      const watch = Effect.gen(function* () {
        if (yield* Ref.get(connecting)) return;
        const page = yield* window.page;
        if (page === 'waiting') {
          const health = yield* requestHealth;
          yield* refreshTray(health);
          if (Option.isSome(health)) yield* connect;
          return;
        }
        if (page === 'app') {
          const health = yield* requestHealth;
          yield* refreshTray(health);
          const missed = Option.isSome(health) ? 0 : (yield* Ref.get(misses)) + 1;
          yield* Ref.set(misses, missed >= MISSES_BEFORE_WAITING ? 0 : missed);
          if (missed >= MISSES_BEFORE_WAITING) yield* connect;
        }
      }).pipe(Effect.withSpan('Connection.watch'));
      const run = Effect.fn('Connection.run')(function* (action: EngineAction) {
        switch (action) {
          case 'open-login-items':
            return yield* shell.openExternal(LOGIN_ITEMS_URL);
          case 'open-privacy':
            return yield* shell.openExternal(PRIVACY_URL);
          case 'copy-details':
            return yield* shell.writeClipboard(yield* engine.readDetails);
          case 'use-local':
            return yield* Effect.asVoid(source.use(LOCAL_SOURCE));
          case 'restart':
            if (viewer) return yield* connect;
            yield* showScreen({ kind: 'starting' });
            yield* engine.restart;
            return yield* connect;
          case 'retry':
            return yield* connect;
        }
      });
      const start = Effect.gen(function* () {
        yield* Effect.forkIn(
          Stream.runForEach(actions.requests, (action) => later(run(action))),
          scope,
          { startImmediately: true }
        );
        yield* connect;
        yield* Effect.forkIn(Effect.schedule(watch, WATCH_SCHEDULE), scope, { startImmediately: true });
      }).pipe(Effect.withSpan('Connection.start'));
      return Connection.of({ start });
    })
  );
}
