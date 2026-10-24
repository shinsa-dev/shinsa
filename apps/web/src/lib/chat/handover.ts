import { type ChatToolArgs, QUESTION_WITHDRAWN } from '@shinsa/core';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { readList, readString, readStrings } from '@/lib/chat/tool-describe.ts';
import { formatCount } from '@/lib/format/count.ts';
import { listPlanEvidenceKinds, type PlanParameters } from '@/lib/overview/plan-parameters.ts';

export function isWithdrawn(call: ToolCall) {
  return call.result?.startsWith(QUESTION_WITHDRAWN) ?? false;
}

export function resolveAskMeta(call: ToolCall, delegated: boolean) {
  if (call.result === null) return delegated ? 'Waiting for an answer' : 'Waiting for your answer';
  if (isWithdrawn(call)) return 'Withdrawn';
  return call.failed ? 'Not answered' : 'Answered';
}

export function resolveSpotsMeta(args: ChatToolArgs) {
  const spots = readList(args, 'spots').length;
  return spots > 0 ? `${formatCount(spots, 'spot', 'spots')} to review` : null;
}

export function readProposedChange(args: ChatToolArgs) {
  const proposal = args.propose_change;
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null;
  const why = readString(proposal as ChatToolArgs, 'why');
  return why ? { why, request: readString(proposal as ChatToolArgs, 'request') } : null;
}

export function readPlanParameters(args: ChatToolArgs): PlanParameters {
  return {
    impact: readString(args, 'impact') ?? undefined,
    evidence: listPlanEvidenceKinds(readStrings(args, 'evidence')),
    checks: readStrings(args, 'checks'),
    approval: args.approval === true,
  };
}
