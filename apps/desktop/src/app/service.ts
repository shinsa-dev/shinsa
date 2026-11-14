import { Effect, Layer, Stream } from 'effect';
import { CloudSignIn } from '../cloud-sign-in/service.ts';
import { findDeepLink, parseDeepLink } from '../deep-links/links.ts';
import { DesktopHost } from '../host/service.ts';
import type { ShellEvent } from '../shell/schema.ts';
import { DesktopShell } from '../shell/service.ts';
import { AppWindow } from '../window/service.ts';

export const AppLifecycle = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* DesktopHost;
    const shell = yield* DesktopShell;
    const window = yield* AppWindow;
    const signIn = yield* CloudSignIn;
    const openLink = Effect.fn('AppLifecycle.openLink')(function* (raw: string | null) {
      if (raw && (yield* signIn.finish(raw))) return;
      const path = raw ? parseDeepLink(raw) : null;
      if (path) yield* window.open(path);
      yield* window.show;
    });
    const answer = Effect.fn('AppLifecycle.answer')(function* (event: ShellEvent) {
      switch (event._tag) {
        case 'OpenUrl':
          return yield* openLink(event.url);
        case 'SecondInstance':
          return yield* openLink(findDeepLink(event.argv));
        case 'Activate':
          return yield* window.show;
      }
    });
    const firstLink = findDeepLink(host.argv) ?? '';
    const signedIn = yield* signIn.finish(firstLink);
    const first = signedIn ? null : parseDeepLink(firstLink);
    if (first) yield* window.open(first);
    yield* shell.guard({ beforeQuit: window.markQuitting });
    yield* Effect.forkScoped(Stream.runForEach(shell.events, answer), { startImmediately: true });
  })
);
