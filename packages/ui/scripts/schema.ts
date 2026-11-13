import { Schema } from 'effect';

export const IconIndex = Schema.Struct({
  categories: Schema.Record(Schema.String, Schema.Struct({ icons: Schema.Array(Schema.String) })),
});

export class IconsNotFound extends Schema.TaggedError<IconsNotFound, { readonly brand: unique symbol }>()(
  'IconsNotFound',
  { message: Schema.String }
) {}

export class IconsUnrendered extends Schema.TaggedError<IconsUnrendered, { readonly brand: unique symbol }>()(
  'IconsUnrendered',
  { message: Schema.String }
) {}

export class IconsOutOfDate extends Schema.TaggedError<IconsOutOfDate, { readonly brand: unique symbol }>()(
  'IconsOutOfDate',
  { message: Schema.String }
) {}

export interface IconsFileRequest {
  readonly roots: readonly string[];
  readonly out: string;
  readonly index: string;
  readonly check: boolean;
}
