import { describe, expect, test } from 'bun:test';
import { resolveClaudeProcess } from '../../../src/agents/claude/sdk.ts';
import { overrideEnv } from '../../helpers/index.ts';

describe('resolveClaudeProcess', () => {
  test("uses the user's claude binary when there is one and never passes CLAUDECODE on", () => {
    const restore = overrideEnv({ CLAUDECODE: '1', PATH: '/nowhere' });
    try {
      const process = resolveClaudeProcess();
      expect(process.env.CLAUDECODE).toBeUndefined();
      expect('pathToClaudeCodeExecutable' in process).toBe(false);
    } finally {
      restore();
    }
  });

  test('points the SDK at a claude found on the PATH', () => {
    const restore = overrideEnv({
      PATH: `${import.meta.dirname}/../../helpers/fake-claude:${process.env.PATH ?? ''}`,
    });
    try {
      expect(resolveClaudeProcess().pathToClaudeCodeExecutable?.endsWith('fake-claude/claude')).toBe(true);
    } finally {
      restore();
    }
  });
});
