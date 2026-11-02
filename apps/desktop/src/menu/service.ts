import { Context, Effect, Layer, Ref, Stream } from 'effect';
import { APP_NAME } from '../app/schema.ts';
import { EngineActions } from '../engine-actions/service.ts';
import { DesktopHost } from '../host/service.ts';
import type { ServerHealth } from '../server/schema.ts';
import { EngineServer } from '../server/service.ts';
import { describeServer } from '../server/url.ts';
import { DesktopShell } from '../shell/service.ts';
import { describeAppVersion } from '../updates/channel.ts';
import type { UpdateSnapshot } from '../updates/schema.ts';
import { Updater } from '../updates/service.ts';
import { describeUpdateItem } from '../updates/state.ts';
import { AppWindow } from '../window/service.ts';
import type { MenuCommand } from './schema.ts';
import { listMenuSections } from './template.ts';

export class AppMenu extends Context.Service<
  AppMenu,
  { showServer(health: ServerHealth): Effect.Effect<void> }
>()('shinsa/desktop/menu/AppMenu') {
  static readonly layer = Layer.effect(
    AppMenu,
    Effect.gen(function* () {
      const host = yield* DesktopHost;
      const shell = yield* DesktopShell;
      const window = yield* AppWindow;
      const updater = yield* Updater;
      const actions = yield* EngineActions;
      const { origin } = yield* EngineServer;
      const scope = yield* Effect.scope;
      const credits = yield* Ref.make<string | undefined>(undefined);
      const applyAbout = Effect.gen(function* () {
        const { channel } = yield* updater.snapshot;
        const text = yield* Ref.get(credits);
        const version = describeAppVersion(host.version, channel);
        yield* shell.setAboutPanel(
          text === undefined
            ? { applicationName: APP_NAME, applicationVersion: version }
            : { applicationName: APP_NAME, applicationVersion: version, credits: text }
        );
      });
      const refresh = Effect.fn('AppMenu.refresh')(function* (snapshot: UpdateSnapshot) {
        yield* shell.applyMenu(
          listMenuSections({ ...describeUpdateItem(snapshot.state), visible: snapshot.supported })
        );
        yield* applyAbout;
      });
      const answer = Effect.fn('AppMenu.answer')(function* (command: MenuCommand) {
        switch (command._tag) {
          case 'Show':
            return yield* window.show;
          case 'Open':
            yield* window.open(command.path);
            return yield* window.show;
          case 'Step':
            return yield* window.step(command.offset);
          case 'Reload':
            return yield* window.reload;
          case 'RestartEngine':
            return yield* actions.request('restart');
          case 'Update':
            if (command.install) return yield* updater.install;
            return yield* updater.check(true);
        }
      });
      yield* Effect.forkIn(Stream.runForEach(updater.changes, refresh), scope, { startImmediately: true });
      yield* Effect.forkIn(Stream.runForEach(shell.menuCommands, answer), scope, { startImmediately: true });
      return AppMenu.of({
        showServer: (health) => Effect.andThen(Ref.set(credits, describeServer(origin, health)), applyAbout),
      });
    })
  );
}
