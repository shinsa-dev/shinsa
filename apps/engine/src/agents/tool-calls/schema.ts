import type { RequestId } from '@modelcontextprotocol/sdk/types.js';
import type { CommandOf, DomainError, ShinsaCommand, ShinsaEvent, TeamFeedTask } from '@shinsa/core';
import { Context, Duration, Effect } from 'effect';
import type { ToolCallFailed } from '../tools/schema.ts';

export interface ToolCall {
  runId: string;
  attemptId: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
  requestId?: RequestId;
}

export type CommitHandOver =
  | Omit<CommandOf<'agent.complete_phase'>, 'treeHash' | 'files'>
  | Omit<CommandOf<'agent.complete_fix'>, 'treeHash' | 'files'>;

export type HandOverTool = 'propose_plan' | 'complete_phase' | 'complete_fix' | 'report_review';

export type EffectCallDispatch = (
  command: ShinsaCommand,
  id?: string
) => Effect.Effect<ShinsaEvent[], ToolCallFailed | DomainError>;

export const DelegationMinute = Context.Reference<Duration.Duration>(
  'shinsa/engine/agents/tool-calls/DelegationMinute',
  { defaultValue: () => Duration.minutes(1) }
);

const NO_TEAMMATE_TASKS: readonly TeamFeedTask[] = [];

export const TeammateTasks = Context.Reference<Effect.Effect<readonly TeamFeedTask[]>>(
  'shinsa/engine/agents/tool-calls/TeammateTasks',
  { defaultValue: () => Effect.succeed(NO_TEAMMATE_TASKS) }
);
