import { describe, expect, test } from 'bun:test';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { guardCommand, resolveCommandVerdict } from '../../../src/agents/claude/guard.ts';

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
