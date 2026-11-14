import { Context, type Effect, type Stream } from 'effect';
import type {
  NativeWindowEvent,
  NavigationHistory,
  Rect,
  WaitingQuery,
  WindowGuards,
} from '../window/schema.ts';

export class NativeWindow extends Context.Service<
  NativeWindow,
  {
    readonly contentsId: number;
    readonly events: Stream.Stream<NativeWindowEvent>;
    guard(guards: WindowGuards): Effect.Effect<void>;
    loadUrl(url: string): Effect.Effect<boolean>;
    loadWaiting(query: WaitingQuery): Effect.Effect<boolean>;
    readonly loadWelcome: Effect.Effect<boolean>;
    send(channel: string, value?: unknown): Effect.Effect<void>;
    readonly show: Effect.Effect<void>;
    readonly hide: Effect.Effect<void>;
    readonly reload: Effect.Effect<void>;
    readonly fullScreen: Effect.Effect<boolean>;
    readonly leaveFullScreen: Effect.Effect<void>;
    readonly normalBounds: Effect.Effect<Rect>;
    readonly history: Effect.Effect<NavigationHistory>;
    goTo(index: number): Effect.Effect<void>;
  }
>()('shinsa/desktop/native-window/NativeWindow') {}
