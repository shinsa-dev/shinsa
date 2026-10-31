import { describe, expect, test } from 'bun:test';
import type { UserCommand } from '../../src/commands/index.ts';
import {
  isLocalOnlyCommand,
  LOCAL_ONLY_MESSAGE,
  resolveLocalOnlyRefusal,
} from '../../src/remote/local-only.ts';

describe('local-only commands', () => {
  test('a human-only setting, a human-only repository field and binding an account stay at the keyboard', () => {
    const commands: UserCommand[] = [
      { type: 'settings.change', patch: { mergeMethod: 'squash' } },
      { type: 'repo.update', repoId: 'r', patch: { checkCommands: [] } },
      { type: 'task.bind_account', taskId: 't', account: null },
    ];
    for (const command of commands) {
      expect(isLocalOnlyCommand(command)).toBe(true);
      expect(resolveLocalOnlyRefusal('remote', command)).toBe(LOCAL_ONLY_MESSAGE);
      expect(resolveLocalOnlyRefusal('local', command)).toBeNull();
    }
  });

  test('other settings, repository fields and decisions are open to a remote request', () => {
    const commands: UserCommand[] = [
      { type: 'settings.change', patch: { maxFixRounds: 3 } },
      { type: 'repo.update', repoId: 'r', patch: { name: 'x' } },
      { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null },
    ];
    for (const command of commands) expect(resolveLocalOnlyRefusal('remote', command)).toBeNull();
  });
});
