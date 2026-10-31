import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { UserCommand } from '@shinsa/core';
import { requestJson, requestText } from '@/lib/connection/http.ts';
import { enterReadOnly, READ_ONLY_REFUSAL, selectReadOnlyRefusal } from '@/lib/connection/read-only.ts';
import { connection, sendCommand } from '@/lib/connection/socket.ts';

const PRIORITY: UserCommand = { type: 'task.prioritize', taskId: 't1', priority: 'urgent' };

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('a read-only page', () => {
  it('refuses every command before it reaches a connection', async () => {
    const command = spyOn(connection, 'command').mockResolvedValue(undefined);
    const leave = enterReadOnly();
    await expect(sendCommand(PRIORITY)).rejects.toThrow(READ_ONLY_REFUSAL);
    expect(command).not.toHaveBeenCalled();
    leave();
    await sendCommand(PRIORITY);
    expect(command).toHaveBeenCalledWith(PRIORITY, undefined);
    command.mockRestore();
  });

  it('refuses every write to the API and still reads', async () => {
    const fetched = mock(() => Promise.resolve(Response.json({ ok: true })));
    globalThis.fetch = fetched as unknown as typeof fetch;
    const leave = enterReadOnly();
    await expect(requestJson('/api/tasks/t1/share', {})).rejects.toThrow(READ_ONLY_REFUSAL);
    expect(fetched).not.toHaveBeenCalled();
    expect(await requestText('/api/tasks/t1/share/preview')).toBe('{"ok":true}');
    leave();
    expect(await requestJson('/api/tasks/t1/share', {})).toEqual({ ok: true });
  });

  it('stays read-only while any page holds it, and leaving twice changes nothing', () => {
    const first = enterReadOnly();
    const second = enterReadOnly();
    first();
    first();
    expect(selectReadOnlyRefusal()?.message).toBe(READ_ONLY_REFUSAL);
    second();
    expect(selectReadOnlyRefusal()).toBeNull();
  });
});
