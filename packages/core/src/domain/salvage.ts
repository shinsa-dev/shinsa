import { identity, Option, Schema, SchemaTransformation } from 'effect';

type Decodable = Schema.Codec<unknown, unknown, never, never>;

function resolveSalvage<S extends Decodable>(schema: S) {
  const decode = Schema.decodeUnknownOption(schema);
  return (input: Option.Option<unknown>): Option.Option<S['Type']> => Option.flatMap(input, decode);
}

export function Salvaged<S extends Decodable>(schema: S, fallback: () => S['Type']) {
  const salvage = resolveSalvage(schema);
  return Schema.optionalKey(Schema.Unknown).pipe(
    Schema.decodeTo(
      Schema.toType(schema),
      SchemaTransformation.transformOptional<S['Type'], unknown>({
        decode: (input) => Option.some(Option.getOrElse(salvage(input), fallback)),
        encode: identity,
      })
    )
  );
}

export function SalvagedOrNull<S extends Decodable>(schema: S) {
  return Salvaged(Schema.NullOr(schema), () => null);
}

export function SalvagedOrOmitted<S extends Decodable>(schema: S) {
  const salvage = resolveSalvage(schema);
  return Schema.optionalKey(Schema.Unknown).pipe(
    Schema.decodeTo(
      Schema.optionalKey(Schema.toType(schema)),
      SchemaTransformation.transformOptional<S['Type'], unknown>({ decode: salvage, encode: identity })
    )
  );
}

export function SalvagedItems<S extends Decodable>(item: S, last = Number.POSITIVE_INFINITY) {
  const decode = Schema.decodeUnknownOption(item);
  const salvage = resolveSalvage(Schema.Array(Schema.Unknown));
  return Schema.optionalKey(Schema.Unknown).pipe(
    Schema.decodeTo(
      Schema.mutable(Schema.Array(Schema.toType(item))),
      SchemaTransformation.transformOptional<S['Type'][], unknown>({
        decode: (input) =>
          Option.some(
            Option.match(salvage(input), {
              onNone: () => [],
              onSome: (items) => items.slice(-last).flatMap((entry) => Option.toArray(decode(entry))),
            })
          ),
        encode: identity,
      })
    )
  );
}

export function Truncated(limit: number) {
  return Schema.String.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transform({ decode: (text) => text.slice(0, limit), encode: identity })
    )
  );
}
