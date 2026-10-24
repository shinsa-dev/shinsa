import {
  type ChatEntry,
  type Handoff,
  type HandoffSource,
  type Run,
  type RunHandoff,
  type RunHandoffReason,
  resolveHandoff,
  resolveHandoffPrompt,
  resolveRunBrief,
  type ShinsaState,
  splitHouseRules,
} from '@shinsa/core';
import { log } from '../log/index.ts';
import { type AgentProvider, resolveCapabilities } from './providers/index.ts';
import type { Transcripts } from './transcripts/index.ts';

export interface TurnPlan {
  resume: string | null;
  handoff: Handoff | null;
  record: RunHandoff | null;
}

export interface TurnContext {
  state: ShinsaState;
  run: Run;
  provider: AgentProvider;
  cwd: string;
  transcripts: Transcripts;
  labelOf: (providerId: string) => string;
  recordLost: (sessionId: string) => Promise<void>;
}

const FRESH: TurnPlan = { resume: null, handoff: null, record: null };

function listSessionRuns(context: TurnContext, sessionId: string) {
  return Object.values(context.state.runs)
    .filter((run) => run.taskId === context.run.taskId && run.sessionId === sessionId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

function listConversation(context: TurnContext, sessionId: string): HandoffSource[] {
  return listSessionRuns(context, sessionId).map((run) => ({
    transcriptPath: context.transcripts.resolvePath(run.id),
    entries: context.transcripts.listEntries(run.id),
  }));
}

export function resolveHandoffPlan(
  context: TurnContext,
  reason: RunHandoffReason,
  sessionId: string,
  fromProvider: string
): TurnPlan {
  if (!resolveCapabilities(context.provider).contextHandoff) {
    log.warn('[Runs] The provider takes no context handoff; the step starts fresh', {
      runId: context.run.id,
      provider: context.provider.id,
    });
    return FRESH;
  }
  const fromLabel = context.labelOf(fromProvider);
  const handoff = resolveHandoff({
    reason,
    fromProvider: fromLabel,
    sources: listConversation(context, sessionId),
  });
  if (!handoff) return FRESH;
  return {
    resume: null,
    handoff,
    record: {
      reason,
      fromProvider,
      totalEntries: handoff.totalEntries,
      includedEntries: handoff.includedEntries,
      approxTokens: handoff.approxTokens,
    },
  };
}

export async function resolveTurnPlan(context: TurnContext): Promise<TurnPlan> {
  const { run, provider } = context;
  const sessionId = run.sessionId;
  if (!sessionId) return FRESH;
  const owner = run.sessionProvider ?? run.provider;
  if (owner !== provider.id) return resolveHandoffPlan(context, 'provider_switch', sessionId, owner);
  const capabilities = resolveCapabilities(provider);
  if (run.sessionLost || !capabilities.sessions.resume) {
    return resolveHandoffPlan(context, 'session_restore', sessionId, owner);
  }
  if (!capabilities.sessions.inspect || !provider.inspectSession) return { ...FRESH, resume: sessionId };
  const status = await provider.inspectSession({ cwd: context.cwd, sessionId });
  if (status !== 'missing' && status !== 'empty') return { ...FRESH, resume: sessionId };
  log.warn('[Runs] The session to resume is gone; restoring it from the transcript', {
    runId: run.id,
    sessionId,
    status,
  });
  await context.recordLost(sessionId);
  return resolveHandoffPlan(context, 'session_restore', sessionId, owner);
}

function readBriefing(entry: ChatEntry, rules: string) {
  if (entry.type === 'notice' && entry.notice.kind === 'compaction') return false;
  if (entry.type === 'user' && entry.from === 'shinsa' && entry.text.includes(rules)) return true;
  return null;
}

function hasHouseRules(context: TurnContext, sessionId: string, rules: string) {
  for (const run of listSessionRuns(context, sessionId).reverse()) {
    for (const entry of context.transcripts.listEntries(run.id).reverse()) {
      const briefed = readBriefing(entry, rules);
      if (briefed !== null) return briefed;
    }
  }
  return false;
}

export function resolveTurnBrief(state: ShinsaState, run: Run, override: string | null) {
  const brief = resolveRunBrief(state, run);
  if (override === null) return brief;
  return brief === (run.prompt ?? '') ? override : [brief, override].join('\n\n');
}

export function resolveTurnPrompt(context: TurnContext, plan: TurnPlan, prompt: string, brief: string) {
  if (plan.handoff) return resolveHandoffPrompt(plan.handoff.text, brief);
  if (!plan.resume) return brief;
  const rules = splitHouseRules(brief)?.rules;
  if (!rules) return prompt;
  if (!hasHouseRules(context, plan.resume, rules)) return brief;
  return splitHouseRules(prompt)?.instruction ?? prompt;
}
