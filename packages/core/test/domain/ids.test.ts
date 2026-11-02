import { describe, expect, test } from 'bun:test';
import { Result, Schema } from 'effect';
import {
  FeedbackId,
  GateId,
  ID_LIMIT,
  listIssueMessages,
  MemoryId,
  ProjectId,
  RepoId,
  RunId,
  ScheduleId,
  ServiceId,
  SuggestionId,
  TaskId,
  type Unbranded,
  WatchdogId,
} from '../../src/index.ts';

const IDS = {
  FeedbackId,
  GateId,
  MemoryId,
  ProjectId,
  RepoId,
  RunId,
  ScheduleId,
  ServiceId,
  SuggestionId,
  TaskId,
  WatchdogId,
};

function listRefusals(value: unknown) {
  const decoded = Schema.decodeUnknownResult(Schema.Struct({ taskId: TaskId }))({ taskId: value });
  return Result.isFailure(decoded) ? listIssueMessages(decoded.failure.issue) : [];
}

describe('ids', () => {
  test('every id reads non-empty text up to the limit and keeps its value', () => {
    for (const [name, schema] of Object.entries(IDS)) {
      expect([name, Schema.decodeUnknownSync(schema)('task-1')]).toEqual([name, 'task-1']);
      expect([name, Schema.is(schema)('x'.repeat(ID_LIMIT))]).toEqual([name, true]);
      expect([name, Schema.is(schema)('x'.repeat(ID_LIMIT + 1))]).toEqual([name, false]);
      expect([name, Schema.is(schema)('')]).toEqual([name, false]);
    }
  });

  test('an id refuses with the messages the command parser gives', () => {
    expect(listRefusals(7)).toEqual(['taskId must be text.']);
    expect(listRefusals('')).toEqual(['taskId must not be empty.']);
    expect(listRefusals('x'.repeat(ID_LIMIT + 1))).toEqual([`taskId is longer than ${ID_LIMIT} characters.`]);
    expect(listRefusals('task-1')).toEqual([]);
  });

  test('Unbranded takes the brands off nested records and lists', () => {
    const Shape = Schema.Struct({ taskId: TaskId, runs: Schema.Array(Schema.Struct({ runId: RunId })) });
    const plain: Unbranded<typeof Shape.Type> = { taskId: 'task-1', runs: [{ runId: 'run-1' }] };
    const decoded: Unbranded<typeof Shape.Type> = Schema.decodeUnknownSync(Shape)(plain);
    expect(decoded).toEqual(plain);
  });
});
