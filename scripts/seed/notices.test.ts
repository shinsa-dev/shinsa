import { describe, expect, test } from 'bun:test';
import { Option, Schema } from 'effect';
import { insertNotices } from './notices.ts';

const NOTICES = [{ kind: 'account_switched' }, { kind: 'handoff' }];

const PLACEMENT = { runId: 'task-account-move-run-1', now: 600_000, context: true };

const Entry = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, at: Schema.Number, type: Schema.String, runId: Schema.String })
);

const line = (id: string, at: number) => JSON.stringify({ id, at, type: 'text', runId: 'run-1' });

const listEntries = (lines: readonly string[]) =>
  Option.getOrThrow(insertNotices(lines.join('\n'), NOTICES, PLACEMENT))
    .trim()
    .split('\n')
    .map((entry) => Schema.decodeUnknownSync(Entry)(entry));

describe('insertNotices', () => {
  test('puts the notices after the brief and the context notice last', () => {
    const ids = listEntries([line('a', 1), line('b', 20), line('c', 30)]).map((entry) => entry.id);
    expect(ids).toEqual([
      'a',
      'b',
      'task-account-move-run-1-notice-0',
      'task-account-move-run-1-notice-1',
      'c',
      'task-account-move-run-1-context',
    ]);
  });

  test('each notice keeps the fields of the brief and follows it in time', () => {
    const entries = listEntries([line('a', 1), line('b', 20)]);
    expect(entries[2]).toEqual({
      id: 'task-account-move-run-1-notice-0',
      at: 21,
      type: 'notice',
      runId: 'run-1',
    });
    expect(entries[3]?.at).toBe(22);
    expect(entries.at(-1)?.at).toBe(540_000);
  });

  test('a transcript of one line takes that line as the brief', () => {
    expect(listEntries([line('a', 5)])[1]).toMatchObject({ id: 'task-account-move-run-1-notice-0', at: 6 });
  });

  test('leaves the context notice out when asked to', () => {
    const lines = Option.getOrThrow(
      insertNotices(line('a', 1), NOTICES, { runId: 'run-0', now: 0, context: false })
    );
    expect(
      lines
        .trim()
        .split('\n')
        .map((entry) => Schema.decodeUnknownSync(Entry)(entry).id)
    ).toEqual(['a', 'run-0-notice-0', 'run-0-notice-1']);
  });

  test('a line that is not a transcript entry gives nothing', () => {
    expect(insertNotices(`${line('a', 1)}\nnot json`, NOTICES, PLACEMENT)).toEqual(Option.none());
    expect(insertNotices(JSON.stringify({ id: 'a' }), NOTICES, PLACEMENT)).toEqual(Option.none());
  });
});
