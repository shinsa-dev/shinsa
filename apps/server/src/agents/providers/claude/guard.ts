import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { resolveForbiddenReason } from '../../policy.ts';

function deny(reason: string | null): HookJSONOutput {
  if (!reason) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

export function resolveCommandVerdict(command: string, defaultBranch: string): HookJSONOutput {
  return deny(resolveForbiddenReason(command, defaultBranch));
}

function readCommand(input: Parameters<HookCallback>[0]) {
  if (input.hook_event_name !== 'PreToolUse') return null;
  const value = (input.tool_input as Record<string, unknown>).command;
  return typeof value === 'string' ? value : null;
}

export function guardCommand(defaultBranch: string): HookCallback {
  return (input) => {
    const command = readCommand(input);
    return Promise.resolve(command === null ? {} : resolveCommandVerdict(command, defaultBranch));
  };
}
