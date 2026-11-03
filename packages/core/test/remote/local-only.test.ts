import { describe, expect, test } from 'bun:test';
import type { UserCommand } from '../../src/commands/index.ts';
import {
  isOwnerOnlyCommand,
  OWNER_ONLY_MESSAGE,
  resolveOwnerOnlyRefusal,
} from '../../src/remote/local-only.ts';

describe('owner-only commands', () => {
  test('a human-only setting, a human-only repository field and choosing an account are for the owner', () => {
    const commands: UserCommand[] = [
      { type: 'settings.change', patch: { mergeMethod: 'squash' } },
      { type: 'repo.update', repoId: 'r', patch: { checkCommands: [] } },
      { type: 'task.bind_account', taskId: 't', account: null },
      { type: 'task.retry', taskId: 't', account: { id: 'a', email: 'a@example.com' } },
    ];
    for (const command of commands) {
      expect(isOwnerOnlyCommand(command)).toBe(true);
      expect(resolveOwnerOnlyRefusal('remote', command)).toBe(OWNER_ONLY_MESSAGE);
      expect(resolveOwnerOnlyRefusal('owner', command)).toBeNull();
      expect(resolveOwnerOnlyRefusal('local', command)).toBeNull();
    }
  });

  test('other settings, repository fields, a plain retry and decisions are open to every member', () => {
    const commands: UserCommand[] = [
      { type: 'settings.change', patch: { maxFixRounds: 3 } },
      { type: 'repo.update', repoId: 'r', patch: { name: 'x' } },
      { type: 'task.retry', taskId: 't' },
      { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null },
    ];
    for (const command of commands) expect(resolveOwnerOnlyRefusal('remote', command)).toBeNull();
  });
});
