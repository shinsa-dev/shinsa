import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { UserCommand } from '@shinsa/core';
import { requestEvidenceBody } from '@/lib/connection/evidence.ts';
import { enterReadOnly, READ_ONLY_REFUSAL, selectReadOnlyRefusal } from '@/lib/connection/read-only.ts';
import { requestSecretAnswer } from '@/lib/connection/secrets.ts';
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
    await expect(requestSecretAnswer('g1', { decline: true })).rejects.toThrow(READ_ONLY_REFUSAL);
    expect(fetched).not.toHaveBeenCalled();
    expect(await requestEvidenceBody('/api/evidence/t1/run.log')).toBe('{"ok":true}');
    leave();
    expect(await requestSecretAnswer('g1', { decline: true })).toEqual({ ok: true });
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
