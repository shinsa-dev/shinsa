import { Schema } from 'effect';

export const WaitSample = Schema.Struct({
  label: Schema.String,
  step: Schema.String,
  at: Schema.Number,
  duration: Schema.Number,
  open: Schema.optionalKey(Schema.Boolean),
});
export type WaitSample = typeof WaitSample.Type;

export const WaitSamples = Schema.Array(WaitSample);

export const ProbedTasks = Schema.Array(Schema.Struct({ handle: Schema.String }));

export const TaskRefs = Schema.Struct({ base: Schema.NullOr(Schema.String), head: Schema.String });

export const TaskDiff = Schema.Struct({ files: Schema.Array(Schema.Unknown) });

export class LoadingStatesShown extends Schema.TaggedError<
  LoadingStatesShown,
  { readonly brand: unique symbol }
>()('LoadingStatesShown', { message: Schema.String }) {}

export const WALK_HEIGHT = 1000;

export const SETTLE_MS = 700;

export const HOME = `document.querySelector('header [aria-label="Home"]') || __loading.byPrefix('header button', '^Shinsa') || __loading.byText('nav [data-highlight-item]', 'New task')`;

export const HOME_DONE = `location.pathname === '/' && !!document.querySelector('main textarea')`;
