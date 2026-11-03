import { Context, Effect, Layer, Ref, Stream } from 'effect';
import { CHANNELS, type DesktopWindowState } from '../bridge/schema.ts';
import { EngineActions } from '../engine-actions/service.ts';
import type { EngineScreenView } from '../engine/schema.ts';
import { parseEngineAction, resolveWaitingQuery } from '../engine/screen.ts';
import { NativeWindow } from '../native-window/service.ts';
import { isAppAddress, resolveHistoryStep, resolveNavigation } from '../navigation/origin.ts';
import type { Navigation } from '../navigation/schema.ts';
import { Prefs } from '../prefs/service.ts';
import { EngineServer } from '../server/service.ts';
import { DesktopShell } from '../shell/service.ts';
import { resolveCloseAction } from './close.ts';
import { ABORTED_LOAD, type NativeWindowEvent, type Page, type SenderFrame } from './schema.ts';

export class AppWindow extends Context.Service<
  AppWindow,
  {
    readonly page: Effect.Effect<Page>;
    readonly windowState: Effect.Effect<DesktopWindowState>;
    ownsSender(frame: SenderFrame): boolean;
    isAppSender(frame: SenderFrame): boolean;
    readonly show: Effect.Effect<void>;
    readonly markQuitting: Effect.Effect<void>;
    readonly reload: Effect.Effect<void>;
    readonly showServerPage: Effect.Effect<boolean>;
    showWaiting(view: EngineScreenView): Effect.Effect<boolean>;
    open(path: string): Effect.Effect<void>;
    step(offset: -1 | 1): Effect.Effect<void>;
    sendToPage(channel: string, value?: unknown): Effect.Effect<void>;
  }
>()('shinsa/desktop/window/AppWindow') {
  static readonly layer = Layer.effect(
    AppWindow,
    Effect.gen(function* () {
      const native = yield* NativeWindow;
      const prefs = yield* Prefs;
      const shell = yield* DesktopShell;
      const actions = yield* EngineActions;
      const { origin } = yield* EngineServer;
      const scope = yield* Effect.scope;
      const page = yield* Ref.make<Page>('none');
      const pending = yield* Ref.make('/');
      const quitting = yield* Ref.make(false);
      const hideOnLeave = yield* Ref.make(false);
      const ownsSender = (frame: SenderFrame) => frame.contentsId === native.contentsId;
      const isAppSender = (frame: SenderFrame) =>
        ownsSender(frame) && frame.top && isAppAddress(frame.url, origin);
      const open = Effect.fn('AppWindow.open')(function* (path: string) {
        if ((yield* Ref.get(page)) === 'app') yield* native.send(CHANNELS.navigate, path);
        else yield* Ref.set(pending, path);
      });
      const follow = Effect.fn('AppWindow.follow')(function* (navigation: Navigation) {
        if (navigation.kind === 'external') yield* shell.openExternal(navigation.url);
        if (navigation.kind === 'app' || navigation.kind === 'link') yield* open(navigation.path);
      });
      const later = (effect: Effect.Effect<void>) => Effect.asVoid(Effect.forkIn(effect, scope));
      const hide = Effect.andThen(Ref.set(hideOnLeave, false), native.hide);
      const reload = Effect.gen(function* () {
        if ((yield* Ref.get(page)) === 'app') yield* native.reload;
        else yield* actions.request('retry');
      });
      const navigate = Effect.fn('AppWindow.navigate')(function* (url: string) {
        const current = yield* Ref.get(page);
        const action = current === 'waiting' ? parseEngineAction(url) : null;
        if (action) {
          yield* actions.request(action);
          return false;
        }
        const navigation = resolveNavigation(url, origin);
        if (navigation.kind === 'app' && current === 'app') return true;
        yield* later(follow(navigation));
        return false;
      });
      const close = Effect.gen(function* () {
        yield* Effect.ignore(
          Effect.flatMap(native.normalBounds, (windowBounds) => prefs.write({ windowBounds }))
        );
        const action = resolveCloseAction({
          quitting: yield* Ref.get(quitting),
          fullScreen: yield* native.fullScreen,
        });
        if (action === 'close') return true;
        if (action === 'hide') yield* hide;
        else {
          yield* Ref.set(hideOnLeave, true);
          yield* native.leaveFullScreen;
        }
        return false;
      });
      const handle = Effect.fn('AppWindow.handle')(function* (event: NativeWindowEvent) {
        switch (event._tag) {
          case 'FullScreen':
            if (!event.on && (yield* Ref.get(hideOnLeave))) yield* hide;
            return yield* native.send(CHANNELS.windowState, event.on ? 'fullscreen' : 'window');
          case 'LoadFailed':
            if (!event.mainFrame || event.code === ABORTED_LOAD || (yield* Ref.get(page)) !== 'app') return;
            yield* Ref.set(page, 'none');
            return yield* actions.request('retry');
          case 'RendererGone':
            return yield* reload;
        }
      });
      yield* native.guard({
        navigate,
        openWindow: (url) => later(follow(resolveNavigation(url, origin))),
        close,
      });
      yield* Effect.forkIn(Stream.runForEach(native.events, handle), scope, { startImmediately: true });
      return AppWindow.of({
        page: Ref.get(page),
        windowState: Effect.map(native.fullScreen, (on): DesktopWindowState =>
          on ? 'fullscreen' : 'window'
        ),
        ownsSender,
        isAppSender,
        show: native.show,
        markQuitting: Ref.set(quitting, true),
        reload,
        showServerPage: Effect.gen(function* () {
          const path = yield* Ref.getAndSet(pending, '/');
          yield* Ref.set(page, 'app');
          return yield* native.loadUrl(new URL(path, origin).toString());
        }),
        showWaiting: (view) =>
          Effect.andThen(Ref.set(page, 'waiting'), native.loadWaiting(resolveWaitingQuery(view))),
        open,
        step: Effect.fn('AppWindow.step')(function* (offset: -1 | 1) {
          if ((yield* Ref.get(page)) !== 'app') return;
          const history = yield* native.history;
          const index = resolveHistoryStep(history.urls, history.active, offset, origin);
          if (index !== null) yield* native.goTo(index);
        }),
        sendToPage: native.send,
      });
    })
  );
}
