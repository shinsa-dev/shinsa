import {
  type AgentReply,
  type ChatToolArgs,
  QUESTION_WITHDRAWN,
  REPLY_OUTCOMES,
  type ReplyOutcome,
  readAnsweredReply,
  splitMessageAttachments,
} from '@shinsa/core';
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
  return splitMessageAttachments(readAnsweredReply(call.result));
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

function isReplyOutcome(value: unknown): value is ReplyOutcome {
  return REPLY_OUTCOMES.some((outcome) => outcome === value);
}

export function readHandOverReply(args: ChatToolArgs): AgentReply | null {
  const reply = args.reply;
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return null;
  const headline = readString(reply as ChatToolArgs, 'headline');
  if (!headline) return null;
  const points = readList(reply as ChatToolArgs, 'points').flatMap((point) => {
    const ask = readString(point, 'ask');
    if (!ask || !isReplyOutcome(point.outcome)) return [];
    return [{ ask, outcome: point.outcome, note: readString(point, 'note') ?? '' }];
  });
  return { headline, points, next: readString(reply as ChatToolArgs, 'next') };
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
