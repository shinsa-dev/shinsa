import { DomainError } from '@shinsa/core';
import { Result, Schema } from 'effect';
import { selectClosest } from '../terminal/index.ts';

type FieldKind = 'text' | 'number' | 'integer' | 'boolean' | 'choice' | 'list' | 'json';

export interface FieldSpec {
  name: string;
  kind: FieldKind;
  description: string;
  required?: boolean;
  positional?: 'one' | 'rest';
  choices?: readonly string[];
}

export type Values = Record<string, unknown>;

export interface ParsedArgs {
  values: Values;
  json: boolean;
  help: boolean;
  idempotencyKey: string | null;
}

const GLOBAL_FLAGS = new Set(['--json', '--help', '-h', '--idempotency-key']);

const decodeJsonText = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));

function refuse(message: string): Result.Result<never, DomainError> {
  return Result.fail(new DomainError({ code: 'arguments_invalid', message }));
}

export function serializeFlag(name: string) {
  return `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export function serializeToolKey(name: string) {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function readNumber(field: FieldSpec, raw: string) {
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value))
    return refuse(`${serializeFlag(field.name)} must be a number.`);
  if (field.kind === 'integer' && !Number.isInteger(value))
    return refuse(`${serializeFlag(field.name)} must be a whole number.`);
  return Result.succeed(value);
}

function readBoolean(field: FieldSpec, raw: string) {
  if (['true', 'yes', 'on', '1'].includes(raw)) return Result.succeed(true);
  if (['false', 'no', 'off', '0'].includes(raw)) return Result.succeed(false);
  return refuse(`${serializeFlag(field.name)} must be true or false.`);
}

function parseJsonField(field: FieldSpec, raw: string) {
  return Result.mapError(
    decodeJsonText(raw),
    () =>
      new DomainError({ code: 'arguments_invalid', message: `${serializeFlag(field.name)} must be JSON.` })
  );
}

function readChoice(field: FieldSpec, raw: string) {
  const choices = field.choices ?? [];
  if (!choices.includes(raw))
    return refuse(`${serializeFlag(field.name)} must be one of ${choices.join(', ')}.`);
  return Result.succeed(raw);
}

export function readFieldText(field: FieldSpec, raw: string): Result.Result<unknown, DomainError> {
  switch (field.kind) {
    case 'text':
      return Result.succeed(raw);
    case 'number':
    case 'integer':
      return readNumber(field, raw);
    case 'boolean':
      return readBoolean(field, raw);
    case 'choice':
      return readChoice(field, raw);
    case 'list':
      return Result.succeed(
        raw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      );
    case 'json':
      return parseJsonField(field, raw);
  }
}

function addValue(values: Values, field: FieldSpec, raw: string) {
  return Result.map(readFieldText(field, raw), (value) => {
    values[field.name] =
      field.kind === 'list'
        ? [...((values[field.name] as string[] | undefined) ?? []), ...(value as string[])]
        : value;
  });
}

function selectFlagField(fields: FieldSpec[], flag: string) {
  return fields.find((field) => serializeFlag(field.name) === flag) ?? null;
}

interface FlagRead {
  field: FieldSpec;
  raw: string | null;
  negated: boolean;
}

function readFlag(fields: FieldSpec[], arg: string): Result.Result<FlagRead, DomainError> {
  const [flag = '', inline = null] = arg.includes('=')
    ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
    : [arg, null];
  const direct = selectFlagField(fields, flag);
  if (direct) return Result.succeed({ field: direct, raw: inline, negated: false });
  const negated = flag.startsWith('--no-') ? selectFlagField(fields, `--${flag.slice(5)}`) : null;
  if (negated?.kind === 'boolean' && inline !== null) return refuse(`${flag} takes no value.`);
  if (negated?.kind === 'boolean') return Result.succeed({ field: negated, raw: null, negated: true });
  const flags = fields.filter((field) => !field.positional).map((field) => serializeFlag(field.name));
  const closest = flag.startsWith('--no-') ? null : selectClosest(flag, [...flags, '--json']);
  const hint = closest ? ` Did you mean ${closest}?` : '';
  return refuse(`Unknown option ${flag}.${hint} Add --help to see the options.`);
}

function describeArgument(field: FieldSpec) {
  return field.positional ? `<${field.name}>` : serializeFlag(field.name);
}

function assertRequired(fields: FieldSpec[], values: Values, describe: (field: FieldSpec) => string) {
  const missing = fields.find((field) => field.required && values[field.name] === undefined);
  return missing ? refuse(`${describe(missing)} is required.`) : Result.void;
}

function readPositional(fields: FieldSpec[], words: string[], values: Values) {
  return Result.gen(function* () {
    for (const field of fields.filter((candidate) => candidate.positional)) {
      if (words.length === 0) return;
      if (field.positional === 'rest') {
        const rest = words.splice(0);
        values[field.name] = field.kind === 'list' ? rest : yield* readFieldText(field, rest.join(' '));
      } else {
        yield* addValue(values, field, words.shift() ?? '');
      }
    }
  });
}

function readFlagArg(
  fields: FieldSpec[],
  args: string[],
  index: number,
  values: Values
): Result.Result<number, DomainError> {
  return Result.gen(function* () {
    const { field, raw, negated } = yield* readFlag(fields, args[index] ?? '');
    if (field.kind === 'boolean' && raw === null) {
      values[field.name] = !negated;
      return index;
    }
    const value = raw ?? args[index + 1];
    if (value === undefined) return yield* refuse(`${serializeFlag(field.name)} needs a value.`);
    yield* addValue(values, field, value);
    return raw === null ? index + 1 : index;
  });
}

function readGlobalArg(
  parsed: ParsedArgs,
  args: string[],
  index: number
): Result.Result<number, DomainError> {
  const arg = args[index];
  if (arg === '--json') parsed.json = true;
  if (arg === '--help' || arg === '-h') parsed.help = true;
  if (arg !== '--idempotency-key') return Result.succeed(index);
  const key = args[index + 1];
  if (key === undefined) return refuse('--idempotency-key needs a value.');
  parsed.idempotencyKey = key;
  return Result.succeed(index + 1);
}

export function readArgv(fields: FieldSpec[], args: string[]): Result.Result<ParsedArgs, DomainError> {
  return Result.gen(function* () {
    const values: Values = {};
    const words: string[] = [];
    const parsed: ParsedArgs = { values, json: false, help: false, idempotencyKey: null };
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index] ?? '';
      if (arg === '--') {
        words.push(...args.slice(index + 1));
        break;
      }
      if (GLOBAL_FLAGS.has(arg)) index = yield* readGlobalArg(parsed, args, index);
      else if (arg.startsWith('--')) index = yield* readFlagArg(fields, args, index, values);
      else words.push(arg);
    }
    yield* readPositional(fields, words, values);
    if (words.length > 0)
      return yield* refuse(`Unexpected ${words.join(' ')}. Add --help to see how to use it.`);
    if (!parsed.help) yield* assertRequired(fields, values, describeArgument);
    return parsed;
  });
}

function resolvePropertySchema(field: FieldSpec): Record<string, unknown> {
  const description = field.description;
  switch (field.kind) {
    case 'text':
      return { type: 'string', description };
    case 'number':
      return { type: 'number', description };
    case 'integer':
      return { type: 'integer', description };
    case 'boolean':
      return { type: 'boolean', description };
    case 'choice':
      return { type: 'string', enum: [...(field.choices ?? [])], description };
    case 'list':
      return { type: 'array', items: { type: 'string' }, description };
    case 'json':
      return { description };
  }
}

export function resolveInputSchema(fields: FieldSpec[]) {
  return {
    type: 'object',
    properties: Object.fromEntries(
      fields.map((field) => [serializeToolKey(field.name), resolvePropertySchema(field)])
    ),
    required: fields.filter((field) => field.required).map((field) => serializeToolKey(field.name)),
    additionalProperties: false,
  };
}

function readToolValue(field: FieldSpec, value: unknown): Result.Result<unknown, DomainError> {
  if (typeof value === 'string' && field.kind !== 'text' && field.kind !== 'choice') {
    return readFieldText(field, value);
  }
  if (field.kind === 'choice') return readChoice(field, String(value));
  return Result.succeed(value);
}

export function readToolInput(
  fields: FieldSpec[],
  input: Record<string, unknown>
): Result.Result<Values, DomainError> {
  return Result.gen(function* () {
    const values: Values = {};
    const known = new Set(fields.map((field) => serializeToolKey(field.name)));
    const unknown = Object.keys(input).find((key) => !known.has(key));
    if (unknown !== undefined) return yield* refuse(`Unknown field ${unknown}.`);
    for (const field of fields) {
      const value = input[serializeToolKey(field.name)];
      if (value !== undefined && value !== null) values[field.name] = yield* readToolValue(field, value);
    }
    yield* assertRequired(fields, values, (field) => serializeToolKey(field.name));
    return values;
  });
}
