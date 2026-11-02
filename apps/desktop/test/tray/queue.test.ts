import { describe, expect, it } from 'bun:test';
import { Result, Schema } from 'effect';
import { parseTrayQueue, parseTrayQueueText } from '../../src/tray/queue.ts';
import { TrayQueue } from '../../src/tray/schema.ts';

describe('parseTrayQueue', () => {
  it('reads what needs you and what is working, with a page path for each task', () => {
    const queue = parseTrayQueue({
      briefing: null,
      decisions: [
        {
          taskId: 't1',
          handle: 'LOC-4',
          title: 'Add the  greeting\nfiles',
          label: 'Review',
          kind: 'review',
          url: 'x',
        },
        { taskId: 't 2', handle: null, title: 'Fix login', label: 'Question', kind: 'question', url: 'x' },
      ],
      working: [
        { taskId: 't3', handle: 'LOC-9', title: 'Refactor', label: 'building', kind: 'building', url: 'x' },
      ],
    });
    expect(queue).toEqual({
      decisions: [
        { path: '/tasks/LOC-4', title: 'Add the greeting files', detail: 'Review · LOC-4' },
        { path: '/tasks/t%202', title: 'Fix login', detail: 'Question' },
      ],
      working: [{ path: '/tasks/LOC-9', title: 'Refactor', detail: 'Building · LOC-9' }],
    });
  });

  it('shortens a long title and skips an entry that is not a task', () => {
    const queue = parseTrayQueue({
      decisions: [
        { taskId: 't1', title: 'A'.repeat(60), label: 'Merge' },
        null,
        { taskId: '', title: 'x', label: 'y' },
      ],
      working: [{ taskId: 't2', title: 7, label: 'building' }],
    });
    expect(queue?.decisions).toHaveLength(1);
    expect(queue?.decisions[0]?.title).toBe(`${'A'.repeat(47)}…`);
    expect(queue?.working).toEqual([]);
  });

  it('refuses an answer that is not the queue', () => {
    expect(parseTrayQueue(null)).toBeNull();
    expect(parseTrayQueue({ decisions: [] })).toBeNull();
    expect(parseTrayQueueText('not json')).toBeNull();
    expect(parseTrayQueueText('{"decisions":[],"working":[]}')).toEqual({ decisions: [], working: [] });
  });

  it('only reads the queue, and never writes one back', () => {
    const queue = {
      decisions: [{ path: '/tasks/LOC-4', title: 'Fix login', detail: 'Review' }],
      working: [],
    };
    expect(Result.isFailure(Schema.encodeResult(TrayQueue)(queue))).toBe(true);
    expect(Schema.encodeSync(TrayQueue)({ decisions: [], working: [] })).toEqual({
      decisions: [],
      working: [],
    });
  });
});
