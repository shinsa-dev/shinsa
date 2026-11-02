import { Context, type Effect, type Stream } from 'effect';
import type { TrayClick, TrayView } from '../tray/schema.ts';

export class NativeTray extends Context.Service<
  NativeTray,
  {
    show(view: TrayView): Effect.Effect<void>;
    readonly clicks: Stream.Stream<TrayClick>;
  }
>()('shinsa/desktop/native-tray/NativeTray') {}
