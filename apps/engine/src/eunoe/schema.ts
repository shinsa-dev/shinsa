import { CORE_DEFAULTS, type CoreConfig, createWindowLookup, type WindowLookup } from '@chroxify/eunoe';
import { Context, Schema } from 'effect';
import { DIRECT_BASE_URL } from '../agents/providers/claude/route/schema.ts';

export interface EunoeSettingsShape {
  readonly upstream: string;
  readonly port: number;
  readonly window: WindowLookup;
  readonly config: CoreConfig;
  readonly foldFloor: number;
}

export type RequestEntry = Record<string, unknown>;

const Handoff = Schema.Struct({ label: Schema.String, source: Schema.String, text: Schema.String });

export const StoredThread = Schema.Struct({
  handoffs: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(Handoff))),
  cut: Schema.optionalKey(Schema.String),
  keep: Schema.optionalKey(Schema.Number),
  cleared: Schema.optionalKey(Schema.Number),
  stuck: Schema.optionalKey(Schema.Number),
  host: Schema.optionalKey(Schema.Boolean),
  pins: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String))),
  ratio: Schema.optionalKey(Schema.Number),
  limits: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  recalls: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

export class ForwarderUnavailable extends Schema.TaggedError<
  ForwarderUnavailable,
  { readonly brand: unique symbol }
>()('ForwarderUnavailable', { message: Schema.String }) {}

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

const FOLD_FLOOR_TOKENS = 40_000;

export const EunoeSettings = Context.Reference<EunoeSettingsShape>('shinsa/engine/eunoe/EunoeSettings', {
  defaultValue: () => ({
    upstream: DIRECT_BASE_URL,
    port: 0,
    window: createWindowLookup(),
    config: { ...CORE_DEFAULTS, mode: 'compact' },
    foldFloor: FOLD_FLOOR_TOKENS,
  }),
});

export const EUNOE_DIR = 'eunoe';

export const STOPPING = 'Shinsa is stopping.';

export const IDLE_TIMEOUT_S = 255;

export const CHARS_PER_TOKEN = 3.6;

export const THREADS_DIR = 'threads';

export const REQUEST_LOG = 'requests.jsonl';

export const LOOPBACK = '127.0.0.1';
