import { Schema } from 'effect';

export interface CodeTabOptions {
  base: string;
  task: string;
  folder: string;
  label: string;
  tree: string[];
  files: string[];
  changes: string;
  switches: number;
  unified: boolean;
  out: string | null;
  width: number;
}

const LongTasks = Schema.Struct({ count: Schema.Number, max: Schema.Number, total: Schema.Number });

export const Opened = Schema.Struct({
  workMs: Schema.NullOr(Schema.Number),
  visibleMs: Schema.NullOr(Schema.Number),
  highlightedMs: Schema.NullOr(Schema.Number),
  long: LongTasks,
});
export type Opened = typeof Opened.Type;

export const Toggled = Schema.Struct({
  ms: Schema.NullOr(Schema.Number),
  work: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  long: Schema.Number,
});
export type Toggled = typeof Toggled.Type;

export const StyleWatch = Schema.Struct({
  samples: Schema.Array(Schema.Struct({ at: Schema.Number, value: Schema.NullOr(Schema.String) })),
  over: Schema.Number,
  click: Schema.Number,
});

export const FrameRun = Schema.Struct({
  frames: Schema.Number,
  p95: Schema.Number,
  max: Schema.Number,
  long: LongTasks,
});

export const Blob = Schema.Struct({ content: Schema.NullOr(Schema.String) });

export const TreeEntries = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      path: Schema.String,
      kind: Schema.String,
      size: Schema.NullOr(Schema.Number),
    })
  ),
});

export const ChangedFiles = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      status: Schema.String,
      binary: Schema.Boolean,
      additions: Schema.Number,
      deletions: Schema.Number,
    })
  ),
});

export const Refs = Schema.Struct({ head: Schema.String, base: Schema.String });
export type Refs = typeof Refs.Type;

export const RowLabels = Schema.Array(Schema.NullOr(Schema.String));

export class NothingToOpen extends Schema.TaggedError<NothingToOpen, { readonly brand: unique symbol }>()(
  'NothingToOpen',
  { message: Schema.String }
) {}

export const CODE_EXTENSIONS = /\.(tsx?|jsx?|mjs|css|md|mdx|json|ya?ml|toml|go|rs|py|swift|sh)$/;

export const CODE_HEIGHT = 900;

export const AWAY = { x: 900, y: 500 };

export const MEBIBYTE = 1048576;
