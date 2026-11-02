import type { CoreConfig, WindowLookup } from '@chroxify/eunoe';
import { Schema } from 'effect';

export interface EunoeServerOptions {
  dir: string;
  upstream?: string;
  port?: number;
  window?: WindowLookup;
  tuning?: Partial<CoreConfig>;
  foldFloor?: number;
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

export const STOPPING = 'Shinsa is stopping.';

export const IDLE_TIMEOUT_S = 255;

export const FOLD_FLOOR_TOKENS = 40_000;

export const CHARS_PER_TOKEN = 3.6;

export const THREADS_DIR = 'threads';

export const REQUEST_LOG = 'requests.jsonl';

export const LOOPBACK = '127.0.0.1';
