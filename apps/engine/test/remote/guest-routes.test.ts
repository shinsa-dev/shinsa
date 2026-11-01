import { describe, expect, test } from 'bun:test';
import { type ChatEntry, createState, type ShinsaState } from '@shinsa/core';
import { isGuestRoute } from '../../src/remote/guest-routes.ts';

const BRIEF = '<attachments><attachment url="/api/attachments/a1/brief.png" /></attachments>';

const NOTE = '<attachments><attachment url="/api/attachments/a2/note.txt" /></attachments>';

function createGuestState(): ShinsaState {
  const state = createState();
  return {
    ...state,
    tasks: {
      t1: {
        id: 't1',
        request: `Fix it ${BRIEF}`,
        inbox: [{ id: 'm1', text: `And this ${NOTE}`, at: 1 }],
      },
      t2: {
        id: 't2',
        request: 'Other <attachments><attachment url="/api/attachments/a3/secret.png" /></attachments>',
      },
    } as unknown as ShinsaState['tasks'],
    runs: {
      r1: { id: 'r1', taskId: 't1' },
      r2: { id: 'r2', taskId: 't2' },
    } as unknown as ShinsaState['runs'],
    evidence: {
      e1: { id: 'e1', taskId: 't1', uri: '/api/evidence/t1/round-1/shot.png' },
      e2: { id: 'e2', taskId: 't2', uri: '/api/evidence/t2/round-1/other.png' },
      e3: { id: 'e3', taskId: 't1', uri: '/api/evidence/legacy.png' },
    } as unknown as ShinsaState['evidence'],
  };
}

const ENTRIES: Record<string, ChatEntry[]> = {
  r1: [
    { type: 'tool_result', callId: 'c', status: 'ok', output: '', images: ['/api/evidence/tool1.png'] },
    {
      type: 'user',
      from: 'you',
      text: 'Look at /api/evidence/tool2.png',
      attachments: [
        { kind: 'image', name: 'x', url: '/api/attachments/a4/x.png', mimeType: null, size: null },
      ],
    },
    { type: 'agent', phase: 'final', text: '/api/evidence/tool2.png' },
  ] as unknown as ChatEntry[],
  r2: [
    { type: 'tool_result', callId: 'c', status: 'ok', output: '', images: ['/api/evidence/tool2.png'] },
  ] as unknown as ChatEntry[],
};

const transcripts = { listEntries: (runId: string) => ENTRIES[runId] ?? [] };

function canRead(path: string, method = 'GET') {
  return isGuestRoute(createGuestState(), 't1', method, path, transcripts);
}

describe('isGuestRoute', () => {
  test('reads the task handed off and its code, never another task or the task list', () => {
    expect(canRead('/api/tasks/t1')).toBe(true);
    expect(canRead('/api/tasks/t1/diff', 'HEAD')).toBe(true);
    expect(canRead('/api/tasks/t1/chat')).toBe(true);
    expect(canRead('/api/tasks/t2')).toBe(false);
    expect(canRead('/api/tasks/t1/open')).toBe(false);
    expect(canRead('/api/tasks')).toBe(false);
    expect(canRead('/api/health')).toBe(true);
  });

  test('reads its evidence, its attachments and the images its own chat shows', () => {
    expect(canRead('/api/evidence/t1/round-1/shot.png')).toBe(true);
    expect(canRead('/api/evidence/t1/round-2/later.md')).toBe(true);
    expect(canRead('/api/evidence/legacy.png')).toBe(true);
    expect(canRead('/api/attachments/a1/brief.png')).toBe(true);
    expect(canRead('/api/attachments/a2/note.txt')).toBe(true);
    expect(canRead('/api/evidence/tool1.png')).toBe(true);
    expect(canRead('/api/attachments/a4/x.png')).toBe(true);
  });

  test('never reads another task’s file, even when its own text names the path', () => {
    expect(canRead('/api/evidence/t2/round-1/other.png')).toBe(false);
    expect(canRead('/api/attachments/a3/secret.png')).toBe(false);
    expect(canRead('/api/evidence/tool2.png')).toBe(false);
    expect(canRead('/api/evidence/t1')).toBe(false);
  });

  test('writes nothing and reads nothing else', () => {
    expect(canRead('/api/commands', 'POST')).toBe(false);
    expect(canRead('/api/attachments', 'POST')).toBe(false);
    expect(canRead('/api/settings')).toBe(false);
  });
});
