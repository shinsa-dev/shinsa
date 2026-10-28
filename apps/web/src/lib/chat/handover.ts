import { type ChatToolArgs, QUESTION_WITHDRAWN, readAnsweredReply } from '@shinsa/core';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { readList, readString, readStrings } from '@/lib/chat/tool-describe.ts';
import { formatCount } from '@/lib/format/count.ts';
import { listPlanEvidenceKinds, type PlanParameters } from '@/lib/overview/plan-parameters.ts';

function isWithdrawn(call: ToolCall) {
  return call.result?.startsWith(QUESTION_WITHDRAWN) ?? false;
}

export function resolveAskMeta(call: ToolCall, delegated: boolean) {
  if (call.result === null) return delegated ? 'Waiting for an answer' : 'Waiting for your answer';
  if (isWithdrawn(call)) return 'Withdrawn';
  return call.failed ? 'Not answered' : 'Answered';
}

export function resolveAskAnswer(call: ToolCall) {
  if (call.result === null || call.failed || isWithdrawn(call)) return null;
  return readAnsweredReply(call.result);
}

export function resolveSpotsMeta(args: ChatToolArgs) {
  const spots = readList(args, 'spots').length;
  return spots > 0 ? `${formatCount(spots, 'spot', 'spots')} to review` : null;
}

function readLine(args: ChatToolArgs, key: string) {
  const value = args[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export function hasHandOverWalkthrough(args: ChatToolArgs) {
  const walkthrough = args.walkthrough;
  return Boolean(walkthrough) && typeof walkthrough === 'object' && !Array.isArray(walkthrough);
}

export function readHandOverSpots(args: ChatToolArgs) {
  return readList(args, 'spots').flatMap((spot) => {
    const file = readString(spot, 'file');
    const start = readLine(spot, 'start');
    if (!file || start === null) return [];
    return [
      { file, start, end: Math.max(start, readLine(spot, 'end') ?? start), why: readString(spot, 'why') },
    ];
  });
}

export function readProposedChange(args: ChatToolArgs) {
  const proposal = args.propose_change;
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null;
  const why = readString(proposal as ChatToolArgs, 'why');
  return why ? { why, request: readString(proposal as ChatToolArgs, 'request') } : null;
}

function readPhases(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((phase): phase is number => Number.isInteger(phase) && phase > 0);
}

function readPlanChecks(args: ChatToolArgs) {
  return readList(args, 'verification').flatMap((check) => {
    const command = readString(check, 'command');
    if (!command) return [];
    return [{ label: readString(check, 'label') ?? command, command, phases: readPhases(check.phases) }];
  });
}

export function readPlanParameters(args: ChatToolArgs): PlanParameters {
  return {
    impact: readString(args, 'impact') ?? undefined,
    evidence: listPlanEvidenceKinds(readStrings(args, 'evidence')),
    verification: readPlanChecks(args),
    approval: args.approval === true,
  };
}
