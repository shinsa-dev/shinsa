import { Effect, Option, Schema, SchemaTransformation } from 'effect';
import { identity } from 'effect/Function';

export function createLenientList<S extends Schema.Top & { readonly DecodingServices: never }>(item: S) {
  const decodeItem = Schema.decodeUnknownOption(item);
  return Schema.Array(Schema.Unknown).pipe(
    Schema.decodeTo(
      Schema.Array(Schema.toType(item)),
      SchemaTransformation.transform({
        decode: (items): readonly S['Type'][] => items.flatMap((entry) => Option.toArray(decodeItem(entry))),
        encode: identity,
      })
    ),
    Schema.catchDecoding(() => Effect.succeedSome([]))
  );
}
