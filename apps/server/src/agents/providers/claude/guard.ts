import type { HookCallback, HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { RunRole } from '@shinsa/core';
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

const READ_ONLY_EDIT_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'];

const READ_ONLY_REASON: Partial<Record<RunRole, string>> = {
  agent:
    'You are planning: Shinsa refuses edits until the plan is in. Hand the plan over with `propose_plan`.',
  answerer:
    'You are answering: this step only reads, so Shinsa refuses edits. Hand the answer over with `answer`.',
  researcher:
    'You are researching: this step only reads, so Shinsa refuses edits. Hand the report over with `submit_report`.',
};

function guardEdits(reason: string): HookCallback {
  return (input) => {
    if (input.hook_event_name !== 'PreToolUse' || !READ_ONLY_EDIT_TOOLS.includes(input.tool_name)) {
      return Promise.resolve({});
    }
    return Promise.resolve(deny(reason));
  };
}

export function listReadOnlyHooks(role: RunRole): HookCallbackMatcher[] {
  const guard = guardEdits(READ_ONLY_REASON[role] ?? 'This step only reads: Shinsa refuses edits.');
  return READ_ONLY_EDIT_TOOLS.map((tool) => ({ matcher: tool, hooks: [guard] }));
}
