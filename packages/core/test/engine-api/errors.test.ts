import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import {
  EditConflictWire,
  FileNotFoundWire,
  RequestFailedWire,
  resolveEngineFailureWire,
  serializeEngineFailure,
} from '../../src/engine-api/errors.ts';
import {
  BodyTooLarge,
  CodeUnavailable,
  ConnectRefused,
  ContentTypeInvalid,
  EditConflict,
  FileMissing,
  FileNotFound,
  InspectReadOnly,
  LocalOnly,
  RequestFailed,
  RequestForbidden,
  RouteNotFound,
  ScopeRefused,
  WorktreeMissing,
} from '../../src/engine-api/schema.ts';

function expectWire<Self extends { readonly message: string }, Tag extends string, Code extends string>(
  failure: Parameters<typeof resolveEngineFailureWire<Self, Tag, Code>>[0] & {
    new (fields: { message: string }): Self;
  },
  code: Code,
  status: number
) {
  expect([failure.code, failure.status]).toEqual([code, status]);
  const wire = resolveEngineFailureWire(failure);
  const body = Schema.encodeSync(wire)(new failure({ message: 'Try again.' }));
  expect(body).toEqual({ error: { code, message: 'Try again.' } });
  const decoded = Schema.decodeUnknownSync(wire)(body);
  expect(decoded).toBeInstanceOf(failure);
  expect(decoded.message).toBe('Try again.');
}

describe('engine failures', () => {
  test('every fixed failure answers its code and status as { error: { code, message } }', () => {
    expectWire(RouteNotFound, 'not_found', 404);
    expectWire(RequestForbidden, 'forbidden', 403);
    expectWire(ContentTypeInvalid, 'content_type_invalid', 415);
    expectWire(BodyTooLarge, 'body_too_large', 413);
    expectWire(InspectReadOnly, 'inspect_read_only', 403);
    expectWire(LocalOnly, 'local_only', 403);
    expectWire(ScopeRefused, 'handoff_scope', 403);
    expectWire(ConnectRefused, 'unauthorized', 401);
    expectWire(WorktreeMissing, 'worktree_missing', 404);
    expectWire(CodeUnavailable, 'code_unavailable', 404);
    expectWire(FileMissing, 'file_missing', 404);
  });

  test('a failed request keeps the code core or a service gave it, at 400', () => {
    const body = Schema.encodeSync(RequestFailedWire)(
      new RequestFailed({ code: 'task_settled', message: 'Done.' })
    );
    expect(body).toEqual({ error: { code: 'task_settled', message: 'Done.' } });
    const decoded = Schema.decodeUnknownSync(RequestFailedWire)(body);
    expect([decoded._tag, decoded.code, decoded.message, RequestFailed.status]).toEqual([
      'RequestFailed',
      'task_settled',
      'Done.',
      400,
    ]);
  });

  test('an edit that lost the race carries the text on disk beside the error', () => {
    const conflict = new EditConflict({
      message: 'a.ts changed on disk since the editor read it.',
      content: 'x',
    });
    const body = Schema.encodeSync(EditConflictWire)(conflict);
    expect(body).toEqual({
      error: { code: 'file_changed', message: 'a.ts changed on disk since the editor read it.' },
      content: 'x',
    });
    const decoded = Schema.decodeUnknownSync(EditConflictWire)(body);
    expect([decoded._tag, decoded.content, EditConflict.status]).toEqual(['EditConflict', 'x', 409]);
  });

  test('a missing evidence or attachment file answers the plain text it always did', () => {
    expect(Schema.encodeSync(FileNotFoundWire)(new FileNotFound({}))).toBe('Not found');
    expect(Schema.decodeUnknownSync(FileNotFoundWire)('Not found')).toBeInstanceOf(FileNotFound);
    expect(FileNotFound.status).toBe(404);
  });

  test('serializes any failure with a code as the wire body', () => {
    expect(serializeEngineFailure({ code: 'body_invalid', message: 'No.' })).toEqual({
      error: { code: 'body_invalid', message: 'No.' },
    });
  });
});
