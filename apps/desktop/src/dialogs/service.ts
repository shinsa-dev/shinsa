import { Context, type Effect } from 'effect';
import type { MessageDialog } from './schema.ts';

export class Dialogs extends Context.Service<
  Dialogs,
  { show(dialog: MessageDialog): Effect.Effect<number> }
>()('shinsa/desktop/dialogs/Dialogs') {}
