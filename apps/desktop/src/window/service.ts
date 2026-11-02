import { Context, type Effect } from 'effect';

export class AppWindow extends Context.Service<
  AppWindow,
  {
    readonly show: Effect.Effect<void>;
    readonly markQuitting: Effect.Effect<void>;
  }
>()('shinsa/desktop/window/AppWindow') {}
