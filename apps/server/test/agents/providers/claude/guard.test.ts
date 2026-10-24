import { describe, expect, test } from 'bun:test';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { guardCommand, resolveCommandVerdict } from '../../../../src/agents/providers/claude/guard.ts';

function denied(command: string, branch = 'main') {
  return 'hookSpecificOutput' in resolveCommandVerdict(command, branch);
}

describe('the command guard', () => {
  test('denies commits, pushes, history rewrites and pull request merges, however git is invoked', () => {
    for (const command of [
      'git commit -m x',
      'git -C ../x commit -am y',
      'git --no-pager commit',
      'git -c user.name=x push origin HEAD',
      'cd app && git rebase main',
      'git reset --hard HEAD~1',
      'gh pr merge 3 --squash',
      'gh pr create --fill',
    ]) {
      expect(denied(command)).toBe(true);
    }
  });

  test('allows reading history and moving between task branches', () => {
    for (const command of [
      'git log --grep commit',
      'git status',
      'git diff main',
      'git checkout feature/main-menu',
      'gh pr view 3',
    ]) {
      expect(denied(command)).toBe(false);
    }
  });

  test('keeps the agent off the default branch, whatever characters its name has', () => {
    expect(denied('git checkout main')).toBe(true);
    expect(denied('git switch -c main')).toBe(true);
    expect(denied('git checkout release/1.0', 'release/1.0')).toBe(true);
    expect(denied('git checkout release/1x0', 'release/1.0')).toBe(false);
  });

  test('keeps every decision only the human makes out of the agent’s shell, and the rest of the command line open', () => {
    for (const command of [
      'shinsa plans approve SW-142',
      'shinsa plans revise SW-142 Shorter',
      'shinsa reviews approve SW-1 --json',
      'shinsa reviews verdicts SW-1 --dismiss 0',
      'cd app && shinsa merges approve SW-142',
      'shinsa merges reject SW-142',
      'shinsa operations run SW-142 Staging first',
      'shinsa operations finish SW-142',
      'shinsa gates answer gate-1 --decision approve',
      'shinsa gates secret gate-1 hunter2',
      'shinsa gates decline-secret gate-1',
      'shinsa accounts sign-in',
      'shinsa accounts sign-in-code login-1 abc',
      'shinsa mcp sign-in claude:linear',
      'shinsa tasks open SW-1',
      'shinsa command gate.answer --fields \'{"gateId":"g","decision":"approve"}\'',
    ]) {
      expect({ command, denied: denied(command) }).toEqual({ command, denied: true });
    }
    for (const command of [
      'shinsa tasks list',
      'shinsa tasks show SW-142',
      'shinsa questions answer SW-1 Yes',
      'shinsa tasks opened',
      'shinsa commander',
      'echo "shinsa merges approved"',
    ]) {
      expect({ command, denied: denied(command) }).toEqual({ command, denied: false });
    }
    expect(resolveCommandVerdict('shinsa merges approve SW-1', 'main')).toMatchObject({
      hookSpecificOutput: {
        permissionDecisionReason:
          'Only the human runs this command: it decides at a gate, gives a secret, signs in, changes accounts, MCP servers, skills or plugins, opens a task in the browser or sends a raw command. Tell them what you need; it waits for them in Shinsa.',
      },
    });
  });

  test('only looks at Bash commands before they run', async () => {
    const hook = guardCommand('main');
    const signal = new AbortController().signal;
    const run = (input: unknown) => hook(input as HookInput, undefined, { signal });
    expect(await run({ hook_event_name: 'PostToolUse', tool_input: { command: 'git push' } })).toEqual({});
    expect(await run({ hook_event_name: 'PreToolUse', tool_input: {} })).toEqual({});
    expect(await run({ hook_event_name: 'PreToolUse', tool_input: { command: 'ls' } })).toEqual({});
    expect(await run({ hook_event_name: 'PreToolUse', tool_input: { command: 'git push' } })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });
  });
});
