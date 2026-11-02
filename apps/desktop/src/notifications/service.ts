import { Context, type Effect } from 'effect';
import type { DesktopNotice } from './schema.ts';

export class Notifications extends Context.Service<
  Notifications,
  { show(notice: DesktopNotice): Effect.Effect<void> }
>()('shinsa/desktop/notifications/Notifications') {}
