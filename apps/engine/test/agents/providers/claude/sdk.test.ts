import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import type { ClaudeExecutable } from '../../../../src/agents/providers/claude/executable/schema.ts';
import { resolveClaudeLaunch } from '../../../../src/agents/providers/claude/sdk/launch.ts';
import { ClaudeSetupError } from '../../../../src/agents/providers/claude/sdk/schema.ts';
import { ClaudeSdk } from '../../../../src/agents/providers/claude/sdk/service.ts';
import { ProgramVersions } from '../../../../src/agents/providers/versions/service.ts';
import { ShellLayer } from '../../../../src/shell/layers.ts';
import { overrideEnv } from '../../../helpers/index.ts';

function resolveClaudeProcess(executable: ClaudeExecutable) {
  return Effect.runPromise(resolveClaudeLaunch(Effect.succeed(executable)));
}

function resolveInstalled() {
  return Effect.runPromise(
    ClaudeSdk.use((sdk) => sdk.resolveExecutable).pipe(
      Effect.provide(ClaudeSdk.layer.pipe(Layer.provide(ProgramVersions.layer), Layer.provide(ShellLayer)))
    )
  );
}

describe('resolveClaudeLaunch', () => {
  test("points the SDK at the user's claude, keeps its browsers headless and never passes CLAUDECODE or another proxy's route on", async () => {
    const restore = overrideEnv({
      CLAUDECODE: '1',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:38663',
      CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE: '1000000000',
      EUNOE_DIR: '/Users/someone/.eunoe',
    });
    try {
      const process = await resolveClaudeProcess({
        ok: true,
        path: '/usr/local/bin/claude',
        version: '2.1.300',
      });
      expect(process.version).toBe('2.1.300');
      expect(process.options.pathToClaudeCodeExecutable).toBe('/usr/local/bin/claude');
      expect(process.options.env.CLAUDECODE).toBeUndefined();
      expect(process.options.env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(process.options.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE).toBeUndefined();
      expect(process.options.env.EUNOE_DIR).toBeUndefined();
      expect(process.options.env.PLAYWRIGHT_MCP_HEADLESS).toBe('true');
      expect(process.options.env.PLAYWRIGHT_MCP_DEVICE).toBe('Desktop Chrome HiDPI');
      const shared = await Effect.runPromise(
        resolveClaudeLaunch(
          Effect.succeed({ ok: true, path: '/usr/local/bin/claude', version: '2.1.300' }),
          'ws://127.0.0.1:7446/browser/cdp/key'
        )
      );
      expect(shared.options.env.PLAYWRIGHT_MCP_CDP_ENDPOINT).toBe('ws://127.0.0.1:7446/browser/cdp/key');
      expect(shared.options.env.PLAYWRIGHT_MCP_DEVICE).toBeUndefined();
      expect(shared.options.env.PLAYWRIGHT_MCP_HEADLESS).toBe('true');
    } finally {
      restore();
    }
  });

  test('a missing or outdated claude fails with ClaudeSetupError saying what to do', async () => {
    const missing = await Effect.runPromise(
      Effect.flip(
        resolveClaudeLaunch(
          Effect.succeed({ ok: false, reason: 'not_installed', message: 'Claude Code is not installed.' })
        )
      )
    );
    expect(missing).toBeInstanceOf(ClaudeSetupError);
    expect(missing.message).toBe('Claude Code is not installed.');
  });

  test('the SDK service finds claude through CLAUDE_EXECUTABLE or the PATH', async () => {
    const restore = overrideEnv({ CLAUDE_EXECUTABLE: '/opt/wrapper/claude' });
    try {
      expect(await resolveInstalled()).toEqual({ ok: true, path: '/opt/wrapper/claude', version: null });
    } finally {
      restore();
    }
    const onPath = overrideEnv({
      CLAUDE_EXECUTABLE: undefined,
      PATH: `${join(import.meta.dirname, '../../../helpers/bin')}:${process.env.PATH ?? ''}`,
    });
    try {
      expect(await resolveInstalled()).toMatchObject({
        ok: true,
        path: join(import.meta.dirname, '../../../helpers/bin/claude'),
      });
    } finally {
      onPath();
    }
  });
});
