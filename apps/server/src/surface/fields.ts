import { DomainError } from '@shinsa/core';

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

const GLOBAL_FLAGS = new Set(['--json', '--help', '-h']);

function refuse(message: string): never {
  throw new DomainError('arguments_invalid', message);
}

export function serializeFlag(name: string) {
  return `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export function serializeToolKey(name: string) {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function readNumber(field: FieldSpec, raw: string) {
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) refuse(`${serializeFlag(field.name)} must be a number.`);
  if (field.kind === 'integer' && !Number.isInteger(value)) {
    refuse(`${serializeFlag(field.name)} must be a whole number.`);
  }
  return value;
}

function readBoolean(field: FieldSpec, raw: string) {
  if (['true', 'yes', 'on', '1'].includes(raw)) return true;
  if (['false', 'no', 'off', '0'].includes(raw)) return false;
  return refuse(`${serializeFlag(field.name)} must be true or false.`);
}

function parseJsonField(field: FieldSpec, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return refuse(`${serializeFlag(field.name)} must be JSON.`);
  }
}

function readChoice(field: FieldSpec, raw: string) {
  const choices = field.choices ?? [];
  if (!choices.includes(raw)) refuse(`${serializeFlag(field.name)} must be one of ${choices.join(', ')}.`);
  return raw;
}

export function readFieldText(field: FieldSpec, raw: string): unknown {
  switch (field.kind) {
    case 'text':
      return raw;
    case 'number':
    case 'integer':
      return readNumber(field, raw);
    case 'boolean':
      return readBoolean(field, raw);
    case 'choice':
      return readChoice(field, raw);
    case 'list':
      return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    case 'json':
      return parseJsonField(field, raw);
  }
}

function addValue(values: Values, field: FieldSpec, raw: string) {
  const value = readFieldText(field, raw);
  if (field.kind === 'list') {
    values[field.name] = [...((values[field.name] as string[] | undefined) ?? []), ...(value as string[])];
    return;
  }
  values[field.name] = value;
}

function selectFlagField(fields: FieldSpec[], flag: string) {
  return fields.find((field) => serializeFlag(field.name) === flag) ?? null;
}

interface FlagRead {
  field: FieldSpec;
  raw: string | null;
  negated: boolean;
}

function readFlag(fields: FieldSpec[], arg: string): FlagRead {
  const [flag = '', inline = null] = arg.includes('=')
    ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
    : [arg, null];
  const direct = selectFlagField(fields, flag);
  if (direct) return { field: direct, raw: inline, negated: false };
  const negated = flag.startsWith('--no-') ? selectFlagField(fields, `--${flag.slice(5)}`) : null;
  if (negated?.kind === 'boolean' && inline !== null) refuse(`${flag} takes no value.`);
  if (negated?.kind === 'boolean') return { field: negated, raw: null, negated: true };
  return refuse(`Unknown option ${flag}. Add --help to see the options.`);
}

function describeArgument(field: FieldSpec) {
  return field.positional ? `<${field.name}>` : serializeFlag(field.name);
}

function assertRequired(fields: FieldSpec[], values: Values, describe: (field: FieldSpec) => string) {
  for (const field of fields) {
    if (field.required && values[field.name] === undefined) refuse(`${describe(field)} is required.`);
  }
}

function readPositional(fields: FieldSpec[], words: string[], values: Values) {
  for (const field of fields.filter((candidate) => candidate.positional)) {
    if (words.length === 0) return;
    if (field.positional === 'rest') {
      const rest = words.splice(0);
      values[field.name] = field.kind === 'list' ? rest : readFieldText(field, rest.join(' '));
    } else {
      addValue(values, field, words.shift() ?? '');
    }
  }
}

export function readArgv(fields: FieldSpec[], args: string[]): ParsedArgs {
  const values: Values = {};
  const words: string[] = [];
  const parsed: ParsedArgs = { values, json: false, help: false, idempotencyKey: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (GLOBAL_FLAGS.has(arg)) {
      if (arg === '--json') parsed.json = true;
      else parsed.help = true;
      continue;
    }
    if (arg === '--idempotency-key') {
      parsed.idempotencyKey = args[index + 1] ?? refuse('--idempotency-key needs a value.');
      index += 1;
      continue;
    }
    if (arg === '--') {
      words.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      words.push(arg);
      continue;
    }
    const { field, raw, negated } = readFlag(fields, arg);
    if (field.kind === 'boolean' && raw === null) {
      values[field.name] = !negated;
      continue;
    }
    const value = raw ?? args[index + 1];
    if (value === undefined) refuse(`${serializeFlag(field.name)} needs a value.`);
    if (raw === null) index += 1;
    addValue(values, field, value);
  }
  readPositional(fields, words, values);
  if (words.length > 0) refuse(`Unexpected ${words.join(' ')}. Add --help to see how to use it.`);
  if (!parsed.help) assertRequired(fields, values, describeArgument);
  return parsed;
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

function readToolValue(field: FieldSpec, value: unknown): unknown {
  if (typeof value === 'string' && field.kind !== 'text' && field.kind !== 'choice') {
    return readFieldText(field, value);
  }
  if (field.kind === 'choice') return readChoice(field, String(value));
  return value;
}

export function readToolInput(fields: FieldSpec[], input: Record<string, unknown>): Values {
  const values: Values = {};
  const known = new Set(fields.map((field) => serializeToolKey(field.name)));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) refuse(`Unknown field ${key}.`);
  }
  for (const field of fields) {
    const value = input[serializeToolKey(field.name)];
    if (value !== undefined && value !== null) values[field.name] = readToolValue(field, value);
  }
  assertRequired(fields, values, (field) => serializeToolKey(field.name));
  return values;
}
