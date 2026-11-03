import { Context, type Effect } from 'effect';
import type { DesktopNotice, NativeNotice } from '../notifications/schema.ts';

export class NativeNotices extends Context.Service<
  NativeNotices,
  {
    readonly supported: boolean;
    show(notice: DesktopNotice): Effect.Effect<NativeNotice>;
  }
>()('shinsa/desktop/native-notices/NativeNotices') {}
