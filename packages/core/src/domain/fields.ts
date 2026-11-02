import { identity, Option, Schema, SchemaTransformation } from 'effect';

export const ID_LIMIT = 200;

export const TEXT_LIMIT = 200_000;

export const LIST_LIMIT = 500;

export const NOTE_LIMIT = 2_000;

export const FIELD_MESSAGES = {
  text: '{key} must be text.',
  empty: '{key} must not be empty.',
  boolean: '{key} must be true or false.',
  number: '{key} must be a number.',
  wholeNumber: '{key} must be a whole number.',
  count: '{key} must be a whole number of 1 or more.',
  index: '{key} must be a whole number of 0 or more.',
  time: '{key} must be a time.',
  list: '{key} must be a list.',
  object: '{key} must be an object.',
} as const;

export function Text(limit = TEXT_LIMIT) {
  return Schema.String.annotate({ message: FIELD_MESSAGES.text })
    .check(Schema.isMaxLength(limit, { message: `{key} is longer than ${limit} characters.` }))
    .annotateKey({ messageMissingKey: FIELD_MESSAGES.text });
}

export function Id(limit = ID_LIMIT) {
  return Text(limit).check(Schema.isNonEmpty({ message: FIELD_MESSAGES.empty }));
}

export function resolveChoiceMessage(choices: Iterable<string>) {
  return `{key} must be one of ${[...choices].join(', ')}.`;
}

export function Choice<const L extends string>(choices: Iterable<L>) {
  const message = resolveChoiceMessage(choices);
  return Schema.Literals([...choices])
    .annotate({ message })
    .annotateKey({ messageMissingKey: message });
}

export const Bool = Schema.Boolean.annotate({ message: FIELD_MESSAGES.boolean }).annotateKey({
  messageMissingKey: FIELD_MESSAGES.boolean,
});

export function NumberOf(message: string, accepts: (value: number) => boolean) {
  return Schema.Number.annotate({ message })
    .check(Schema.makeFilter(accepts, { message }))
    .annotateKey({ messageMissingKey: message });
}

export const FiniteNumber = NumberOf(FIELD_MESSAGES.number, Number.isFinite);

export const Time = NumberOf(FIELD_MESSAGES.time, Number.isFinite);

export const WholeNumber = NumberOf(FIELD_MESSAGES.wholeNumber, Number.isInteger);

export const Count = NumberOf(FIELD_MESSAGES.count, (value) => Number.isInteger(value) && value >= 1);

export const Index = NumberOf(FIELD_MESSAGES.index, (value) => Number.isInteger(value) && value >= 0);

export function Optional<S extends Schema.Top>(schema: S, message: string) {
  return Schema.optionalKey(Schema.UndefinedOr(schema).annotate({ message }));
}

export function OrNull<S extends Schema.Top>(schema: S, message: string) {
  return Schema.NullOr(schema).annotate({ message }).annotateKey({ messageMissingKey: message });
}

export function NullByDefault<S extends Schema.Top>(schema: S, message: string) {
  return Schema.optionalKey(Schema.Union([schema, Schema.Null, Schema.Undefined]).annotate({ message })).pipe(
    Schema.decodeTo(
      Schema.NullOr(Schema.toType(schema)),
      SchemaTransformation.transformOptional<S['Type'] | null, S['Type'] | null | undefined>({
        decode: (value) =>
          Option.some(
            Option.match(value, { onNone: () => null, onSome: (inner): S['Type'] | null => inner ?? null })
          ),
        encode: identity,
      })
    )
  );
}

export function ByDefault<S extends Schema.Top>(schema: S, message: string, fallback: () => S['Type']) {
  return Schema.optionalKey(Schema.UndefinedOr(schema).annotate({ message })).pipe(
    Schema.decodeTo(
      Schema.toType(schema),
      SchemaTransformation.transformOptional<S['Type'], S['Type'] | undefined>({
        decode: (value) =>
          Option.some(
            Option.match(value, { onNone: fallback, onSome: (inner): S['Type'] => inner ?? fallback() })
          ),
        encode: identity,
      })
    )
  );
}

export function List<S extends Schema.Top>(item: S, limit = LIST_LIMIT) {
  return Schema.Array(Schema.Unknown)
    .annotate({ message: FIELD_MESSAGES.list })
    .check(Schema.isMaxLength(limit, { message: `{key} has more than ${limit} entries.` }))
    .pipe(
      Schema.decodeTo(Schema.mutable(Schema.Array(item)), SchemaTransformation.passthrough({ strict: false }))
    )
    .annotateKey({ messageMissingKey: FIELD_MESSAGES.list });
}

export function KnownKeys(subject: string, keys: ReadonlyArray<string>, refuse: (key: string) => string) {
  const message = `${subject} must be an object.`;
  return Schema.Record(Schema.String, Schema.Unknown)
    .annotate({ message })
    .check(
      Schema.makeFilter((record: { readonly [key: string]: unknown }) => {
        const unknown = Object.keys(record).find((key) => !keys.includes(key));
        return unknown === undefined ? undefined : refuse(unknown);
      })
    )
    .annotateKey({ messageMissingKey: message });
}

export function Strict<const F extends Schema.Struct.Fields>(fields: F, name: string, subject = name) {
  const message = `${subject} must be an object.`;
  return KnownKeys(subject, Object.keys(fields), (key) => `${name} cannot change ${key}.`)
    .pipe(Schema.decodeTo(Schema.Struct(fields), SchemaTransformation.passthrough({ strict: false })))
    .annotateKey({ messageMissingKey: message });
}

export function Tagged<
  const K extends string,
  const L extends string,
  const M extends ReadonlyArray<Schema.Top>,
>(tag: K, choices: Iterable<L>, members: M) {
  return Schema.StructWithRest(
    Schema.Struct({ [tag]: Choice(choices) } as { [P in K]: ReturnType<typeof Choice<L>> }),
    [Schema.Record(Schema.String, Schema.Unknown)]
  )
    .annotate({ message: FIELD_MESSAGES.object })
    .pipe(Schema.decodeTo(Schema.Union(members), SchemaTransformation.passthrough({ strict: false })))
    .annotateKey({ messageMissingKey: FIELD_MESSAGES.object });
}
