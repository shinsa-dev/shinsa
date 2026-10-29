import { describe, expect, test } from 'bun:test';
import type { ShinsaCommand, ShinsaEvent } from '@shinsa/core';
import { handleProcessTool } from '../../../src/agents/tools/process.ts';

function createCall(events: ShinsaEvent[] = []) {
  const sent: ShinsaCommand[] = [];
  return {
    sent,
    call: {
      runId: 'run-1',
      attemptId: 'a-1',
      dispatch: (command: ShinsaCommand) => {
        sent.push(command);
        return Promise.resolve(events);
      },
    },
  };
}

describe('the process tools', () => {
  test('wait_for schedules the check and tells the agent to end its turn', async () => {
    const { sent, call } = createCall();
    expect(await handleProcessTool('wait_for', { check_in_minutes: 1, notes: 'The deploy.' }, call)).toBe(
      'Shinsa will resume your session in a minute with your notes. Stop here without a closing message.'
    );
    expect(
      await handleProcessTool(
        'wait_for',
        { check_in_minutes: 15, notes: 'CI.', timeout_minutes: 120, max_attempts: 4 },
        call
      )
    ).toContain('in 15 minutes');
    expect(sent).toEqual([
      {
        type: 'agent.wait_for',
        runId: 'run-1',
        attemptId: 'a-1',
        checkInMinutes: 1,
        notes: 'The deploy.',
        timeoutMinutes: null,
        maxAttempts: null,
      },
      {
        type: 'agent.wait_for',
        runId: 'run-1',
        attemptId: 'a-1',
        checkInMinutes: 15,
        notes: 'CI.',
        timeoutMinutes: 120,
        maxAttempts: 4,
      },
    ]);
  });

  test('wait_for once the wait has run out tells the agent the human decides now', async () => {
    const { call } = createCall([
      {
        type: 'monitor.ended',
        taskId: 't',
        monitorId: 'm',
        status: 'exhausted',
        seq: 1,
        at: 0,
      } as ShinsaEvent,
    ]);
    expect(await handleProcessTool('wait_for', { check_in_minutes: 1, notes: 'The deploy.' }, call)).toBe(
      'Your wait ran out, so Shinsa asked the human what to do. Stop here without a closing message.'
    );
  });

  test('remember proposes the rule and lets the agent carry on', async () => {
    const { sent, call } = createCall();
    const reply = await handleProcessTool(
      'remember',
      { scope: 'global', text: ' Keep plans short. ', why: 'The human said so twice.' },
      call
    );
    expect(reply).toBe('Proposed. The human decides whether agents remember it. Carry on with your step.');
    expect(sent).toEqual([
      {
        type: 'agent.remember',
        runId: 'run-1',
        attemptId: 'a-1',
        scope: 'global',
        text: 'Keep plans short.',
        why: 'The human said so twice.',
      },
    ]);
    expect(handleProcessTool('remember', { scope: 'repo', text: 'x', why: 'y' }, call)).rejects.toThrow(
      'scope must be one of global, project.'
    );
  });

  test('suggest_tasks hands the follow-ups over and lets the agent carry on', async () => {
    const { sent, call } = createCall();
    const reply = await handleProcessTool(
      'suggest_tasks',
      { tasks: [{ title: 'Cache it', request: 'Cache the export.', why: 'It is slow.', after_this: true }] },
      call
    );
    expect(reply).toBe('Suggested. The human decides whether to add them. Carry on with your step.');
    expect(sent[0]).toEqual({
      type: 'agent.suggest_tasks',
      runId: 'run-1',
      attemptId: 'a-1',
      suggestions: [
        { title: 'Cache it', request: 'Cache the export.', why: 'It is slow.', waitsOnThis: true },
      ],
    });
  });

  test('a broken call is rejected with the reasons, and other tools are not this module’s', async () => {
    const { sent, call } = createCall();
    expect(handleProcessTool('wait_for', { check_in_minutes: 0 }, call)).rejects.toThrow(
      'Shinsa rejected this hand-over.'
    );
    expect(handleProcessTool('answer', {}, call)).rejects.toThrow('answer');
    expect(handleProcessTool('suggest_tasks', { tasks: [] }, call)).rejects.toThrow('tasks');
    expect(await handleProcessTool('note', { note: 'x' }, call)).toBeNull();
    expect(sent).toEqual([]);
  });
});
