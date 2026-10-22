import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';

interface ForbiddenCommand {
  pattern: RegExp;
  reason: string;
}

const GIT = String.raw`\bgit(?:\s+(?:-[cC]\s+\S+|--[\w-]+(?:=\S+)?))*\s+`;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listForbiddenCommands(defaultBranch: string): ForbiddenCommand[] {
  return [
    {
      pattern: /\bgh\s+pr\s+(merge|create)\b/,
      reason: 'Shinsa opens and merges pull requests; the human approves merges.',
    },
    {
      pattern: new RegExp(`${GIT}(commit|push|rebase|reset\\s+--hard)\\b`),
      reason: 'Shinsa commits and pushes when you hand over. Do not rewrite history.',
    },
    {
      pattern: new RegExp(
        `${GIT}(checkout|switch)\\s+(-[a-zA-Z]\\s+)?${escapeRegExp(defaultBranch)}(?![\\w./-])`
      ),
      reason: 'Stay on the task branch.',
    },
  ];
}

export function resolveCommandVerdict(command: string, defaultBranch: string): HookJSONOutput {
  const hit = listForbiddenCommands(defaultBranch).find((rule) => rule.pattern.test(command));
  if (!hit) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: hit.reason,
    },
  };
}

export function guardCommand(defaultBranch: string): HookCallback {
  return (input) => {
    if (input.hook_event_name !== 'PreToolUse') return Promise.resolve({});
    const command = (input.tool_input as { command?: unknown }).command;
    if (typeof command !== 'string') return Promise.resolve({});
    return Promise.resolve(resolveCommandVerdict(command, defaultBranch));
  };
}
