import type { CoreConfig, ThreadStore, WindowLookup } from '@chroxify/eunoe';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { EunoeStatus, EunoeWatcher } from '../../agents/providers/claude/index.ts';

export class EunoeRewriteFailed extends Schema.TaggedError<
  EunoeRewriteFailed,
  { readonly brand: unique symbol }
>()('EunoeRewriteFailed', { message: Schema.String }) {}

export class FoldUnavailable extends Schema.TaggedError<FoldUnavailable, { readonly brand: unique symbol }>()(
  'FoldUnavailable',
  { message: Schema.String }
) {}

export class RequestLogUnwritable extends Schema.TaggedError<
  RequestLogUnwritable,
  { readonly brand: unique symbol }
>()('RequestLogUnwritable', { message: Schema.String }) {}

export type Forwarder = ReturnType<typeof Bun.serve>;

export interface FoldToken {
  readonly warm: boolean;
}

export interface EunoeServerDefinition {
  readonly dir: string;
  readonly upstream: string;
  readonly port: number;
  readonly window: WindowLookup;
  readonly config: CoreConfig;
  readonly store: ThreadStore;
  readonly foldFloor: number;
}

export interface EunoeServerHandle {
  readonly ensure: Effect.Effect<EunoeStatus>;
  readonly watch: (sessionId: string, watcher: EunoeWatcher) => Effect.Effect<Effect.Effect<void>>;
  readonly fold: (sessionId: string, warm: boolean) => Effect.Effect<Effect.Effect<void>>;
  readonly stop: Effect.Effect<void>;
}
