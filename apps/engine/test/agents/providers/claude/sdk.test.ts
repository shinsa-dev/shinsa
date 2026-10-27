import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  CLAUDE_RUNTIME,
  ClaudeSetupError,
  resolveClaudeProcess,
} from '../../../../src/agents/providers/claude/sdk.ts';
import { overrideEnv } from '../../../helpers/index.ts';

describe('resolveClaudeProcess', () => {
  test("points the SDK at the user's claude and never passes CLAUDECODE or another proxy's route on", async () => {
    const restore = overrideEnv({
      CLAUDECODE: '1',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:38663',
      CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE: '1000000000',
      EUNOE_DIR: '/Users/someone/.eunoe',
    });
    try {
      const process = await resolveClaudeProcess(() =>
        Promise.resolve({ ok: true, path: '/usr/local/bin/claude', version: '2.1.300' })
      );
      expect(process.version).toBe('2.1.300');
      expect(process.options.pathToClaudeCodeExecutable).toBe('/usr/local/bin/claude');
      expect(process.options.env.CLAUDECODE).toBeUndefined();
      expect(process.options.env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(process.options.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE).toBeUndefined();
      expect(process.options.env.EUNOE_DIR).toBeUndefined();
    } finally {
      restore();
    }
  });

  test('a missing or outdated claude stops the run with what to do', async () => {
    const missing = resolveClaudeProcess(() =>
      Promise.resolve({ ok: false, reason: 'not_installed', message: 'Claude Code is not installed.' })
    );
    expect(missing).rejects.toBeInstanceOf(ClaudeSetupError);
    expect(missing).rejects.toThrow('Claude Code is not installed.');
  });

  test('the default runtime finds claude through CLAUDE_EXECUTABLE or the PATH', async () => {
    const restore = overrideEnv({ CLAUDE_EXECUTABLE: '/opt/wrapper/claude' });
    try {
      expect(await CLAUDE_RUNTIME.resolveExecutable()).toEqual({
        ok: true,
        path: '/opt/wrapper/claude',
        version: null,
      });
    } finally {
      restore();
    }
    const onPath = overrideEnv({
      CLAUDE_EXECUTABLE: undefined,
      PATH: `${join(import.meta.dirname, '../../../helpers/bin')}:${process.env.PATH ?? ''}`,
    });
    try {
      expect(await CLAUDE_RUNTIME.resolveExecutable()).toMatchObject({
        ok: true,
        path: join(import.meta.dirname, '../../../helpers/bin/claude'),
      });
    } finally {
      onPath();
    }
  });
});
