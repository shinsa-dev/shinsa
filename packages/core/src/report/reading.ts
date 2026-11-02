import { Predicate, Result, Schema, type SchemaAST, SchemaIssue, SchemaTransformation } from 'effect';
import { listIssueMessages, resolveIssuePath } from '../domain/issues.ts';

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export type HandOverPath = ReadonlyArray<PropertyKey>;

const REQUIRED = '{path} is required.';

const NOT_OBJECT = '{path} must be an object.';

const NOT_LIST = '{path} must be a list.';

const AbsentAsNull = Schema.Undefined.pipe(
  Schema.decodeTo(
    Schema.Null,
    SchemaTransformation.transform({ decode: () => null, encode: () => undefined })
  )
);

function resolveTextFallback(value: unknown) {
  return Predicate.isString(value) ? value.trim() : '';
}

function isWithin(limit: number) {
  return Schema.makeFilter((text: string | null) =>
    text === null || text.length <= limit
      ? undefined
      : `{path} is ${text.length} characters; the limit is ${limit}.`
  );
}

export function Required(limit: number) {
  return Schema.String.annotate({ message: REQUIRED })
    .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.trim()))
    .annotate({ fallback: resolveTextFallback })
    .check(Schema.isNonEmpty({ message: REQUIRED }), isWithin(limit));
}

export function OptionalText(limit: number) {
  const given = Schema.String.pipe(
    Schema.decodeTo(
      Schema.NullOr(Schema.String),
      SchemaTransformation.transform({
        decode: (text) => (text === '' ? null : text.trim()),
        encode: (text) => text ?? '',
      })
    )
  ).check(
    Schema.makeFilter((text: string | null) => text === null || text.length > 0 || REQUIRED),
    isWithin(limit)
  );
  return Schema.Union([AbsentAsNull, Schema.Null, given]).annotate({
    message: REQUIRED,
    fallback: resolveTextFallback,
  });
}

const LINE_MESSAGE = '{path} must be a line number (1 or more).';

export const LineNumber = Schema.Number.annotate({ message: LINE_MESSAGE, fallback: () => 0 }).check(
  Schema.makeFilter((line: number) => Number.isInteger(line) && line > 0, { message: LINE_MESSAGE })
);

export function WholeNumber(message: string, accepts: (value: number) => boolean, fallback: number) {
  return Schema.Number.annotate({ message, fallback: () => fallback }).check(
    Schema.makeFilter((value: number) => Number.isInteger(value) && accepts(value), { message })
  );
}

export function CountUpTo(max: number) {
  return WholeNumber(
    `{path} must be a whole number from 1 to ${max}.`,
    (count) => count >= 1 && count <= max,
    1
  );
}

export const Flag = Schema.Union([
  Schema.Undefined.pipe(
    Schema.decodeTo(
      Schema.Literal(false),
      SchemaTransformation.transform({ decode: () => false as const, encode: () => undefined })
    )
  ),
  Schema.Boolean,
]).annotate({ message: '{path} must be true or false.', fallback: () => false });

export function OneOf<const L extends string>(choices: readonly [L, ...L[]]) {
  return Schema.Literals(choices).annotate({
    message: `{path} must be one of ${choices.join(', ')}.`,
    fallback: () => choices[0],
  });
}

export function OptionalOneOf<const L extends string>(choices: readonly [L, ...L[]]) {
  const choice = OneOf(choices);
  const given = Schema.String.pipe(
    Schema.decodeTo(
      Schema.NullOr(choice),
      SchemaTransformation.transform<L | null, string>({
        decode: (text) => (text === '' ? null : (text as L)),
        encode: (picked) => picked ?? '',
      })
    )
  );
  return Schema.Union([AbsentAsNull, Schema.Null, given]).annotate({
    message: `{path} must be one of ${choices.join(', ')}.`,
    fallback: () => choices[0],
  });
}

export function Items<S extends Schema.Top>(item: S, max: number, min = 0) {
  return Schema.mutable(Schema.Array(item))
    .annotate({ handOver: 'list', max, min })
    .check(
      Schema.makeFilter(
        (items: ReadonlyArray<unknown>) =>
          items.length >= min || `{path} needs at least ${min} item${min === 1 ? '' : 's'}.`,
        { raw: true }
      ),
      Schema.makeFilter(
        (items: ReadonlyArray<unknown>) =>
          items.length <= max || `{path} has ${items.length} items; the limit is ${max}.`,
        { raw: true }
      )
    );
}

export function HandOverRecord<const F extends Schema.Struct.Fields>(fields: F) {
  return Schema.Struct(fields).annotate({ handOver: 'record' });
}

export function OrAbsent<S extends Schema.Top>(schema: S) {
  return Schema.Union([AbsentAsNull, Schema.Null, schema]).annotate({ handOver: 'optional' });
}

export function OptionalWholeRecord<const F extends Schema.Struct.Fields>(
  fields: F,
  ...checks: ReadonlyArray<SchemaAST.Check<Schema.Struct.Type<F>>>
) {
  const record = Schema.Struct(fields).annotate({ handOver: 'record', halts: true });
  const [first, ...rest] = checks;
  return OrAbsent(first ? record.check(first, ...rest) : record);
}

export function OrOmitted<S extends Schema.Top>(schema: S) {
  return Schema.Union([AbsentAsNull, schema]).annotate({ handOver: 'omittable' });
}

export function ListOrRecord<L extends Schema.Top, R extends Schema.Top>(list: L, record: R) {
  return Schema.Union([list, record]).annotate({ handOver: 'either' });
}

export function ReadWhen<S extends Schema.Top>(schema: S, when: (record: never) => boolean) {
  return Schema.NullOr(schema).annotate({ handOver: 'when', when });
}

const decoders = new WeakMap<SchemaAST.AST, ReturnType<typeof Schema.decodeUnknownResult>>();

function resolveDecoder(ast: SchemaAST.AST) {
  const known = decoders.get(ast);
  if (known) return known;
  const decoder = Schema.decodeUnknownResult(Schema.make<Schema.Codec<unknown>>(ast));
  decoders.set(ast, decoder);
  return decoder;
}

function isFields(value: unknown): value is { readonly [key: string]: unknown } {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function listFilters(checks: SchemaAST.Checks | undefined): SchemaAST.Filter<unknown>[] {
  return (checks ?? []).flatMap((check) =>
    check._tag === 'FilterGroup' ? listFilters(check.checks) : [check]
  );
}

function selectMember(ast: SchemaAST.AST, index: number) {
  return (ast as SchemaAST.Union).types[index] ?? ast;
}

export class HandOverReader {
  readonly errors: string[] = [];

  read<S extends Schema.Top>(schema: S, value: unknown, path: HandOverPath): S['Type'] {
    return this.readNode(schema.ast, value, path) as S['Type'];
  }

  refuse(message: string) {
    this.errors.push(message);
  }

  result<T>(value: T): Validation<T> {
    return this.errors.length === 0 ? { ok: true, value } : { ok: false, errors: this.errors };
  }

  private readNode(ast: SchemaAST.AST, value: unknown, path: HandOverPath): unknown {
    switch (ast.annotations?.handOver) {
      case 'record':
        return this.readRecord(ast as SchemaAST.Objects, value, path);
      case 'list':
        return this.readList(ast as SchemaAST.Arrays, value, path);
      case 'optional':
        if (value === undefined || value === null) return null;
        return this.readNode(selectMember(ast, 2), value, path);
      case 'omittable':
        if (value === undefined) return null;
        return this.readNode(selectMember(ast, 1), value, path);
      case 'either':
        return this.readNode(selectMember(ast, Array.isArray(value) ? 0 : 1), value, path);
      default:
        return this.readLeaf(ast, value, path);
    }
  }

  private readRecord(ast: SchemaAST.Objects, value: unknown, path: HandOverPath) {
    const fields = isFields(value) ? value : {};
    if (!isFields(value)) {
      this.errors.push(NOT_OBJECT.replaceAll('{path}', resolveIssuePath(path)));
      if (ast.annotations?.halts === true) return null;
    }
    const record: { [key: string]: unknown } = {};
    const filters = listFilters(ast.checks);
    for (const field of ast.propertySignatures) {
      const name = String(field.name);
      record[name] = this.readField(field.type, fields[name], [...path, name], record);
      this.runFilters(
        filters.filter((filter) => filter.annotations?.after === name),
        record,
        ast,
        path
      );
    }
    this.runFilters(
      filters.filter((filter) => filter.annotations?.after === undefined),
      record,
      ast,
      path
    );
    return record;
  }

  private readField(
    ast: SchemaAST.AST,
    value: unknown,
    path: HandOverPath,
    record: { readonly [key: string]: unknown }
  ) {
    if (ast.annotations?.handOver !== 'when') return this.readNode(ast, value, path);
    const when = ast.annotations.when;
    if (Predicate.isFunction(when) && !when(record)) return null;
    return this.readNode(selectMember(ast, 0), value, path);
  }

  private readList(ast: SchemaAST.Arrays, value: unknown, path: HandOverPath) {
    const { min, max } = ast.annotations ?? {};
    const filters = listFilters(ast.checks);
    if (value === undefined && min === 0) {
      this.runFilters(
        filters.filter((filter) => filter.annotations?.raw !== true),
        [],
        ast,
        path
      );
      return [];
    }
    if (!Array.isArray(value)) {
      this.errors.push(NOT_LIST.replaceAll('{path}', resolveIssuePath(path)));
      return [];
    }
    this.runFilters(
      filters.filter((filter) => filter.annotations?.raw === true),
      value,
      ast,
      path
    );
    const [item] = ast.rest;
    const items = value
      .slice(0, Predicate.isNumber(max) ? max : value.length)
      .map((entry, index) => (item ? this.readNode(item, entry, [...path, index]) : entry));
    this.runFilters(
      filters.filter((filter) => filter.annotations?.raw !== true),
      items,
      ast,
      path
    );
    return items;
  }

  private readLeaf(ast: SchemaAST.AST, value: unknown, path: HandOverPath) {
    const decoded = resolveDecoder(ast)(value, { errors: 'all' });
    if (Result.isSuccess(decoded)) return decoded.success;
    this.errors.push(...listIssueMessages(new SchemaIssue.Pointer(path, decoded.failure.issue)));
    const fallback = ast.annotations?.fallback;
    return Predicate.isFunction(fallback) ? fallback(value) : undefined;
  }

  private runFilters(
    filters: ReadonlyArray<SchemaAST.Filter<unknown>>,
    value: unknown,
    ast: SchemaAST.AST,
    path: HandOverPath
  ) {
    for (const filter of filters) {
      const issue = filter.run(value, ast, {});
      if (issue) this.errors.push(...listIssueMessages(new SchemaIssue.Pointer(path, issue)));
    }
  }
}

export function EndAfter<const K extends string>(start: K) {
  return Schema.makeFilter(
    (record: { readonly [P in K | 'end']: number | null }) =>
      record[start] === null || record.end === null || record.end >= record[start]
        ? undefined
        : `{path}.end comes before {path}.${start}.`,
    { after: 'end' }
  );
}

export function TextList(max: number, item: number) {
  return Items(Required(item), max);
}
