import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import * as shapes from '../../src/engine-api/schema.ts';
import {
  AccountLoginRequest,
  AnyBody,
  CommandAnswer,
  OkAnswer,
  TeamCreateAnswer,
  ATTACHMENT_LIMIT_BYTES,
  ATTACHMENT_UPLOAD_LIMIT_BYTES,
  FilledText,
  ModelsAnswer,
  IdempotencyKey,
  OpenRequest,
  ProjectPathBody,
  ProvidersAnswer,
  RestartRequest,
  UserCommandBody,
} from '../../src/engine-api/schema.ts';

const STRUCT_ANSWERS = new Set([
  'OkAnswer',
  'OpenAnswer',
  'CommandAnswer',
  'RestartAnswer',
  'TeamLinkAnswer',
  'TeamCreateAnswer',
  'ProvidersAnswer',
  'ModelsAnswer',
]);

const ANSWERS = Object.entries(shapes).filter(
  ([name, value]) => /Answer(?:Body)?$/.test(name) && !STRUCT_ANSWERS.has(name) && Schema.isSchema(value)
) as [string, Schema.Codec<unknown, unknown>][];

describe('EngineApi shapes', () => {
  test.each(ANSWERS)('%s passes an object answer through and refuses anything else', (_name, answer) => {
    const body = { ok: true, tasks: [] };
    expect(Schema.decodeUnknownSync(answer)(body)).toEqual(body);
    expect(Schema.encodeSync(answer)(body)).toEqual(body);
    expect(() => Schema.decodeUnknownSync(answer)('text')).toThrow();
  });

  test('the answers Shinsa builds itself are checked field by field', () => {
    expect(Schema.decodeUnknownSync(CommandAnswer)({ ok: true, taskId: null, handle: null })).toEqual({
      ok: true,
      taskId: null,
      handle: null,
    });
    expect(() => Schema.decodeUnknownSync(OkAnswer)({ ok: false })).toThrow();
    expect(Schema.decodeUnknownSync(TeamCreateAnswer)({ teamId: 't', url: 'u' })).toEqual({
      teamId: 't',
      url: 'u',
    });
  });

  test('the providers and the models answers are lists', () => {
    for (const answer of [ProvidersAnswer, ModelsAnswer]) {
      expect(Schema.decodeUnknownSync(answer)([])).toEqual([]);
      expect(() => Schema.decodeUnknownSync(answer)({})).toThrow();
    }
  });

  test('opening a file keeps a path only when it is text and a line only when it is a whole number above 0', () => {
    const decode = Schema.decodeUnknownSync(OpenRequest);
    expect(decode({ target: 'editor', path: 'src/a.ts', line: 3 })).toEqual({
      target: 'editor',
      path: 'src/a.ts',
      line: 3,
    });
    expect(decode({ target: 'finder', path: '', line: 1.5 })).toEqual({
      target: 'finder',
      path: null,
      line: null,
    });
    expect(decode({ target: 'terminal', path: 4, line: 0 })).toEqual({
      target: 'terminal',
      path: null,
      line: null,
    });
    expect(decode({ target: 'finder' })).toEqual({ target: 'finder' });
    expect(() => decode({ target: 'vim' })).toThrow();
    expect(Schema.encodeSync(OpenRequest)({ target: 'editor', path: 'a', line: 2 })).toEqual({
      target: 'editor',
      path: 'a',
      line: 2,
    });
  });

  test('a project path that is not text is read as empty, as the folder resolver expects', () => {
    expect(Schema.decodeUnknownSync(ProjectPathBody)({ path: 3 })).toEqual({ path: '' });
    expect(Schema.decodeUnknownSync(ProjectPathBody)({ path: '~/code' })).toEqual({ path: '~/code' });
    expect(Schema.encodeSync(ProjectPathBody)({ path: '~/code' })).toEqual({ path: '~/code' });
  });

  test('a name, an id or a link must have text in it', () => {
    expect(Schema.decodeUnknownSync(FilledText)(' team ')).toBe(' team ');
    expect(() => Schema.decodeUnknownSync(FilledText)('  ')).toThrow();
  });

  test('an idempotency key is at most 200 characters once trimmed', () => {
    expect(Schema.decodeUnknownSync(IdempotencyKey)(` ${'k'.repeat(200)} `)).toHaveLength(202);
    expect(() => Schema.decodeUnknownSync(IdempotencyKey)('k'.repeat(201))).toThrow();
  });

  test('signing in names an account or none', () => {
    expect(Schema.decodeUnknownSync(AccountLoginRequest)({})).toEqual({});
    expect(Schema.decodeUnknownSync(AccountLoginRequest)({ accountId: null })).toEqual({ accountId: null });
    expect(() => Schema.decodeUnknownSync(AccountLoginRequest)({ accountId: '' })).toThrow();
  });

  test('a restart is now or once agents are idle', () => {
    expect(Schema.decodeUnknownSync(RestartRequest)({ when: 'idle' })).toEqual({ when: 'idle' });
    expect(() => Schema.decodeUnknownSync(RestartRequest)({ when: 'later' })).toThrow();
  });

  test('a command body is any JSON, for core’s parseUserCommand to check', () => {
    expect<unknown>(Schema.decodeUnknownSync(UserCommandBody)('not a command')).toBe('not a command');
    expect(Schema.decodeUnknownSync(AnyBody)({ a: 1 })).toEqual({ a: 1 });
  });

  test('an attachment upload may carry the base64 of a 25 MB file and its fields', () => {
    expect(ATTACHMENT_UPLOAD_LIMIT_BYTES).toBe(Math.ceil((ATTACHMENT_LIMIT_BYTES * 4) / 3) + 64 * 1024);
  });
});
