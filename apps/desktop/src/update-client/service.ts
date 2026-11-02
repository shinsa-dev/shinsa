import { Context, type Effect, type Option, type Stream } from 'effect';
import type { Download, UpdateCheckFailed, UpdateEvent, UpdaterOptions } from '../updates/schema.ts';

export class UpdateClient extends Context.Service<
  UpdateClient,
  {
    readonly events: Stream.Stream<UpdateEvent>;
    configure(options: UpdaterOptions): Effect.Effect<void>;
    readonly check: Effect.Effect<Option.Option<Download>, UpdateCheckFailed>;
    readonly quitAndInstall: Effect.Effect<void>;
  }
>()('shinsa/desktop/update-client/UpdateClient') {}
