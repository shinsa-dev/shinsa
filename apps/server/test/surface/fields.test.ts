import { describe, expect, test } from 'bun:test';
import { DomainError } from '@shinsa/core';
import {
  type FieldSpec,
  readArgv,
  readFieldText,
  readToolInput,
  resolveInputSchema,
  serializeFlag,
  serializeToolKey,
} from '../../src/surface/fields.ts';

const TASK: FieldSpec = {
  name: 'task',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The task.',
};

const TEXT: FieldSpec = {
  name: 'text',
  kind: 'text',
  positional: 'rest',
  required: true,
  description: 'The message.',
};

const FIELDS: FieldSpec[] = [
  { name: 'planFirst', kind: 'boolean', description: 'Plan first.' },
  { name: 'limit', kind: 'integer', description: 'At most.' },
  { name: 'hours', kind: 'number', description: 'Hours.' },
  { name: 'priority', kind: 'choice', choices: ['low', 'high'], description: 'Priority.' },
  { name: 'after', kind: 'list', description: 'Tasks.' },
  { name: 'fields', kind: 'json', description: 'JSON.' },
  { name: 'repo', kind: 'text', description: 'Repository.' },
];

function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return { code: (error as DomainError).code, message: (error as Error).message };
  }
  throw new Error('expected a refusal');
}

describe('flag and tool names', () => {
  test('camelCase names become kebab-case flags and snake_case tool keys', () => {
    expect(serializeFlag('planFirst')).toBe('--plan-first');
    expect(serializeFlag('task')).toBe('--task');
    expect(serializeToolKey('signatureHeader')).toBe('signature_header');
    expect(serializeToolKey('task')).toBe('task');
  });
});

describe('reading the command line', () => {
  test('positional words fill one field, then the rest of the line fills the last', () => {
    const parsed = readArgv([TASK, TEXT], ['abc', 'please', 'add', 'tests']);
    expect(parsed).toEqual({
      values: { task: 'abc', text: 'please add tests' },
      json: false,
      help: false,
      idempotencyKey: null,
    });
  });

  test('a rest field of kind list keeps each word, and other kinds are read from the joined text', () => {
    const waits: FieldSpec = { name: 'waitsOn', kind: 'list', positional: 'rest', description: 'Tasks.' };
    expect(readArgv([TASK, waits], ['a', 'b', 'c']).values).toEqual({ task: 'a', waitsOn: ['b', 'c'] });
    const resume: FieldSpec = { name: 'resume', kind: 'boolean', positional: 'rest', description: 'Resume.' };
    expect(readArgv([resume], ['yes']).values).toEqual({ resume: true });
  });

  test('flags take the next word or an inline value, and are read by their kind', () => {
    const parsed = readArgv(FIELDS, [
      '--limit',
      '5',
      '--hours=1.5',
      '--priority',
      'high',
      '--after',
      'a, b',
      '--after=c',
      '--fields',
      '{"x":1}',
      '--repo=app=1',
    ]);
    expect(parsed.values).toEqual({
      limit: 5,
      hours: 1.5,
      priority: 'high',
      after: ['a', 'b', 'c'],
      fields: { x: 1 },
      repo: 'app=1',
    });
  });

  test('a boolean flag alone is true, --no-x is false, and --x=value reads the words people use', () => {
    expect(readArgv(FIELDS, ['--plan-first']).values).toEqual({ planFirst: true });
    expect(readArgv(FIELDS, ['--no-plan-first']).values).toEqual({ planFirst: false });
    for (const word of ['true', 'yes', 'on', '1']) {
      expect(readArgv(FIELDS, [`--plan-first=${word}`]).values).toEqual({ planFirst: true });
    }
    for (const word of ['false', 'no', 'off', '0']) {
      expect(readArgv(FIELDS, [`--plan-first=${word}`]).values).toEqual({ planFirst: false });
    }
  });

  test('--json, --help, -h and --idempotency-key are read on every command', () => {
    expect(readArgv([TASK], ['t', '--json', '--idempotency-key', 'key-1'])).toEqual({
      values: { task: 't' },
      json: true,
      help: false,
      idempotencyKey: 'key-1',
    });
    expect(readArgv([TASK], ['--help']).help).toBe(true);
    expect(readArgv([TASK], ['-h']).help).toBe(true);
  });

  test('help skips the check for required arguments', () => {
    expect(readArgv([TASK], ['--help']).values).toEqual({});
    expect(refusal(() => readArgv([TASK], []))).toEqual({
      code: 'arguments_invalid',
      message: '<task> is required.',
    });
    const repo: FieldSpec = { name: 'repo', kind: 'text', required: true, description: 'Repository.' };
    expect(refusal(() => readArgv([repo], [])).message).toBe('--repo is required.');
  });

  test('after -- every word is text, even one that looks like a flag', () => {
    expect(readArgv([TASK, TEXT], ['t', '--', '--not', 'a', 'flag']).values).toEqual({
      task: 't',
      text: '--not a flag',
    });
  });

  test('unknown options, missing values and stray words are refused with what to do', () => {
    expect(refusal(() => readArgv(FIELDS, ['--colour', 'red'])).message).toBe(
      'Unknown option --colour. Add --help to see the options.'
    );
    expect(refusal(() => readArgv(FIELDS, ['--no-repo'])).message).toBe(
      'Unknown option --no-repo. Add --help to see the options.'
    );
    expect(refusal(() => readArgv(FIELDS, ['--no-plan-first=true'])).message).toBe(
      '--no-plan-first takes no value.'
    );
    expect(refusal(() => readArgv(FIELDS, ['--limit'])).message).toBe('--limit needs a value.');
    expect(refusal(() => readArgv(FIELDS, ['--idempotency-key'])).message).toBe(
      '--idempotency-key needs a value.'
    );
    expect(refusal(() => readArgv([TASK], ['a', 'b'])).message).toBe(
      'Unexpected b. Add --help to see how to use it.'
    );
  });

  test('a value of the wrong kind is refused, naming the flag', () => {
    expect(refusal(() => readArgv(FIELDS, ['--limit', 'many'])).message).toBe('--limit must be a number.');
    expect(refusal(() => readArgv(FIELDS, ['--limit=  '])).message).toBe('--limit must be a number.');
    expect(refusal(() => readArgv(FIELDS, ['--limit', '1.5'])).message).toBe(
      '--limit must be a whole number.'
    );
    expect(refusal(() => readArgv(FIELDS, ['--plan-first=maybe'])).message).toBe(
      '--plan-first must be true or false.'
    );
    expect(refusal(() => readArgv(FIELDS, ['--priority', 'soon'])).message).toBe(
      '--priority must be one of low, high.'
    );
    expect(refusal(() => readArgv(FIELDS, ['--fields', '{x'])).message).toBe('--fields must be JSON.');
  });

  test('a choice field without choices accepts nothing', () => {
    const bare: FieldSpec = { name: 'in', kind: 'choice', description: 'Where.' };
    expect(refusal(() => readFieldText(bare, 'editor')).message).toBe('--in must be one of .');
  });
});

describe('the MCP input schema', () => {
  test('publishes one snake_case property per field, typed by its kind, and the required ones', () => {
    const fields: FieldSpec[] = [
      { ...TASK },
      ...FIELDS,
      { name: 'note', kind: 'text', description: 'A note.' },
    ];
    expect(resolveInputSchema(fields)).toEqual({
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task.' },
        plan_first: { type: 'boolean', description: 'Plan first.' },
        limit: { type: 'integer', description: 'At most.' },
        hours: { type: 'number', description: 'Hours.' },
        priority: { type: 'string', enum: ['low', 'high'], description: 'Priority.' },
        after: { type: 'array', items: { type: 'string' }, description: 'Tasks.' },
        fields: { description: 'JSON.' },
        repo: { type: 'string', description: 'Repository.' },
        note: { type: 'string', description: 'A note.' },
      },
      required: ['task'],
      additionalProperties: false,
    });
    const bare: FieldSpec = { name: 'in', kind: 'choice', description: 'Where.' };
    expect(resolveInputSchema([bare]).properties.in).toEqual({
      type: 'string',
      enum: [],
      description: 'Where.',
    });
  });

  test('a tool call is read by snake_case key; strings are parsed by kind and nulls are left out', () => {
    const values = readToolInput([TASK, ...FIELDS], {
      task: 'abc',
      plan_first: 'yes',
      limit: 3,
      hours: '2',
      priority: 'low',
      after: ['a', 'b'],
      fields: { x: 1 },
      repo: null,
    });
    expect(values).toEqual({
      task: 'abc',
      planFirst: true,
      limit: 3,
      hours: 2,
      priority: 'low',
      after: ['a', 'b'],
      fields: { x: 1 },
    });
    expect(readToolInput(FIELDS, { after: 'a,b' })).toEqual({ after: ['a', 'b'] });
  });

  test('a tool call with an unknown key, a bad choice or a missing required key is refused', () => {
    expect(refusal(() => readToolInput(FIELDS, { planFirst: true })).message).toBe(
      'Unknown field planFirst.'
    );
    expect(refusal(() => readToolInput(FIELDS, { priority: 3 })).message).toBe(
      '--priority must be one of low, high.'
    );
    expect(refusal(() => readToolInput([TASK], {})).message).toBe('task is required.');
  });
});
