import { Context, type Effect, type Stream } from 'effect';
import type { DesktopStart } from '../bridge/schema.ts';
import type { SenderFrame } from '../window/schema.ts';
import type { PageMessage } from './schema.ts';

export class PageChannel extends Context.Service<
  PageChannel,
  {
    readonly messages: Stream.Stream<PageMessage>;
    serveStart(answer: (frame: SenderFrame) => Effect.Effect<DesktopStart | null>): Effect.Effect<void>;
  }
>()('shinsa/desktop/page-channel/PageChannel') {}
