import { describe, expect, test } from 'bun:test';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import {
  guardCommand,
  listReadOnlyHooks,
  resolveCommandVerdict,
} from '../../../../src/agents/providers/claude/guard.ts';

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

  test('brings the base branch in by merging, never by rebasing', () => {
    for (const command of ['git pull', 'git pull --rebase origin main', 'cd app && git pull -r']) {
      expect({ command, denied: denied(command) }).toEqual({ command, denied: true });
    }
    for (const command of [
      'git fetch origin main && git merge origin/main',
      'git merge --no-edit origin/main',
      'git pull --no-rebase origin main',
      'git merge --abort',
    ]) {
      expect({ command, denied: denied(command) }).toEqual({ command, denied: false });
    }
  });

  test('in a GitButler workspace the agent only reads and resolves conflicted commits in place', () => {
    for (const command of [
      'but commit -b feat/x -m x',
      'but push feat/x',
      'but pull',
      'but resolve 1a2b3c4',
      'but resolve finish',
      'but resolve --ai',
      'cd app && but move feat/x --above fix/y',
      'but --json unapply feat/x',
      'but -C /tmp/app discard nk',
      'git status; but undo',
    ]) {
      expect({ command, denied: denied(command) }).toEqual({ command, denied: true });
    }
    for (const command of [
      'but status --json',
      'but diff',
      'but show feat/x',
      'but --json resolve conflicts feat/x',
      "printf 'a\\n' | but resolve apply a.txt:1 --commit feat/x",
      'but resolve apply a.txt --commit feat/x --theirs',
      'but resolve status',
      'but --help',
      'echo "nothing but tests"',
    ]) {
      expect({ command, denied: denied(command) }).toEqual({ command, denied: false });
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
      'shinsa questions answer SW-1 Yes',
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
      'shinsa tasks create Fix the scroll',
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

  test('keeps stopping and restarting the engine, which runs the agent, out of its shell', () => {
    for (const command of ['shinsa stop', 'shinsa restart --when-idle', 'cd /tmp && shinsa engine']) {
      expect({ command, denied: denied(command) }).toEqual({ command, denied: true });
    }
    for (const command of [
      'shinsa status',
      'shinsa start',
      'shinsa logs --lines 20',
      'shinsa version',
      'shinsa stopwatch',
    ]) {
      expect({ command, denied: denied(command) }).toEqual({ command, denied: false });
    }
    expect(resolveCommandVerdict('shinsa stop', 'main')).toMatchObject({
      hookSpecificOutput: {
        permissionDecisionReason:
          'Only the human stops or restarts Shinsa’s engine: it is what runs you. Tell them why it needs a restart.',
      },
    });
  });

  test('keeps the settings and repository fields only the human changes out of the agent’s shell, and leaves the rest open', () => {
    for (const command of [
      'shinsa settings set approvePlans true',
      'shinsa settings set --json mergeMethod squash',
      'shinsa settings set --key=taskBudgetUsd 5',
      'shinsa settings set fastMode true && echo done',
      'shinsa settings set agentFastModes \'{"builder":true}\'',
      'shinsa settings set delegationLimit 4',
      'shinsa repos update app --checks "bun test"',
      'shinsa repos update app --name web --waive-checks',
      'shinsa repos update app --no-waive-checks',
      'shinsa repos update app --checks=lint',
      'shinsa repos update app --workspace gitbutler',
      'shinsa repos update app --workspace=main_checkout',
      'shinsa repos update app --coverage off',
      'shinsa repos update app --coverage-command="make cover"',
    ]) {
      expect({ command, denied: denied(command) }).toEqual({ command, denied: true });
    }
    for (const command of [
      'shinsa settings set defaultModel sonnet',
      'shinsa settings set maxFixRounds 3',
      'shinsa settings get approvePlans',
      'shinsa settings set compaction eunoe; echo approvePlans',
      'shinsa repos update app --name web --default-branch trunk',
      'shinsa repos list --checks',
    ]) {
      expect({ command, denied: denied(command) }).toEqual({ command, denied: false });
    }
    expect(resolveCommandVerdict('shinsa settings set approvePlans false', 'main')).toMatchObject({
      hookSpecificOutput: {
        permissionDecisionReason:
          'Only the human changes this setting: plan approval, the merge method, budgets and usage limits, resuming, account switching, fast mode and delegations at once. Tell them what you would change and why.',
      },
    });
    expect(resolveCommandVerdict('shinsa repos update app --waive-checks', 'main')).toMatchObject({
      hookSpecificOutput: {
        permissionDecisionReason:
          'Only the human changes a repository’s check commands, works without checks, chooses where agents work or sets how test coverage is measured. Tell them what you would change and why.',
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

describe('the read-only guard', () => {
  test('one matcher per edit tool, each refusing the edit until the plan is in', async () => {
    const matchers = listReadOnlyHooks('agent');
    expect(matchers.map((matcher) => matcher.matcher)).toEqual([
      'Edit',
      'Write',
      'NotebookEdit',
      'MultiEdit',
    ]);
    const hook = matchers[0]?.hooks[0];
    const signal = new AbortController().signal;
    const run = (input: unknown) => hook?.(input as HookInput, undefined, { signal });
    for (const tool of ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']) {
      expect(await run({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: {} })).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'You are planning: Shinsa refuses edits until the plan is in. Hand the plan over with `propose_plan`.',
        },
      });
    }
    expect(await run({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} })).toEqual({});
    expect(await run({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: {} })).toEqual({});
  });

  test('an answer or research step on the task’s session is refused edits with its own hand-over named', async () => {
    const signal = new AbortController().signal;
    const refusal = async (role: 'answerer' | 'researcher' | 'investigator') => {
      const hook = listReadOnlyHooks(role)[0]?.hooks[0];
      const verdict = await hook?.(
        { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {} } as unknown as HookInput,
        undefined,
        { signal }
      );
      return (verdict as { hookSpecificOutput?: { permissionDecisionReason?: string } }).hookSpecificOutput
        ?.permissionDecisionReason;
    };
    expect(await refusal('answerer')).toContain('`answer`');
    expect(await refusal('researcher')).toContain('`submit_report`');
    expect(await refusal('investigator')).toBe('This step only reads: Shinsa refuses edits.');
  });
});
