import { Schema } from 'effect';

export class ReportUnwritable extends Schema.TaggedError<
  ReportUnwritable,
  { readonly brand: unique symbol }
>()('ReportUnwritable', { path: Schema.String, message: Schema.String }) {}
