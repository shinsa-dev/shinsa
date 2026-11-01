import { describe, expect, test } from 'bun:test';
import { createState, type ShinsaState } from '@shinsa/core';
import { isGuestRoute } from '../../src/remote/guest-routes.ts';

function createGuestState(): ShinsaState {
  const state = createState();
  return {
    ...state,
    tasks: {
      t1: { id: 't1', request: 'See /api/attachments/brief.png' },
      t2: { id: 't2', request: 'See /api/attachments/secret.png' },
    } as unknown as ShinsaState['tasks'],
    evidence: {
      e1: { id: 'e1', taskId: 't1', uri: '/api/evidence/t1/shot.png' },
      e2: { id: 'e2', taskId: 't2', uri: '/api/evidence/t2/other.png' },
    } as unknown as ShinsaState['evidence'],
  };
}

describe('isGuestRoute', () => {
  const state = createGuestState();

  test('reads the task handed off and its code, never another task or the task list', () => {
    expect(isGuestRoute(state, 't1', 'GET', '/api/tasks/t1')).toBe(true);
    expect(isGuestRoute(state, 't1', 'HEAD', '/api/tasks/t1/diff')).toBe(true);
    expect(isGuestRoute(state, 't1', 'GET', '/api/tasks/t1/chat')).toBe(true);
    expect(isGuestRoute(state, 't1', 'GET', '/api/tasks/t2')).toBe(false);
    expect(isGuestRoute(state, 't1', 'GET', '/api/tasks/t1/open')).toBe(false);
    expect(isGuestRoute(state, 't1', 'GET', '/api/tasks')).toBe(false);
    expect(isGuestRoute(state, 't1', 'GET', '/api/health')).toBe(true);
  });

  test('reads only the files its task points at', () => {
    expect(isGuestRoute(state, 't1', 'GET', '/api/evidence/t1/shot.png')).toBe(true);
    expect(isGuestRoute(state, 't1', 'GET', '/api/attachments/brief.png')).toBe(true);
    expect(isGuestRoute(state, 't1', 'GET', '/api/evidence/t2/other.png')).toBe(false);
    expect(isGuestRoute(state, 't1', 'GET', '/api/attachments/secret.png')).toBe(false);
  });

  test('writes nothing and reads nothing else', () => {
    expect(isGuestRoute(state, 't1', 'POST', '/api/commands')).toBe(false);
    expect(isGuestRoute(state, 't1', 'POST', '/api/attachments')).toBe(false);
    expect(isGuestRoute(state, 't1', 'GET', '/api/settings')).toBe(false);
  });
});
