import {
  type ChatEntry,
  type HandoffSource,
  needsRoundBrief,
  type Run,
  type RunFork,
  type RunHandoffReason,
  resolveHandoff,
  resolveHandoffPrompt,
  resolveMovedNote,
  resolveRunBrief,
  type ShinsaState,
  selectSessionCwd,
  splitHouseRules,
} from '@shinsa/core';
import { Effect, Option } from 'effect';
import { resolveCapabilities } from '../providers/index.ts';
import { type TurnPlan, type TurnContext, FRESH, type TurnFoldInput } from './schema.ts';

function resolveSessionTaskId(context: TurnContext, sessionId: string) {
  const fork = context.run.fork;
  return fork && fork.sessionId === sessionId ? fork.taskId : context.run.taskId;
}

function listSessionRuns(context: TurnContext, sessionId: string) {
  const taskId = resolveSessionTaskId(context, sessionId);
  return Object.values(context.state.runs)
    .filter((run) => run.taskId === taskId && run.sessionId === sessionId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

function listConversation(context: TurnContext, sessionId: string) {
  return Effect.forEach(listSessionRuns(context, sessionId), (run) =>
    Effect.map(context.transcripts.listEntries(run.id), (entries): HandoffSource => ({
      transcriptPath: context.transcripts.resolvePath(run.id),
      entries,
    }))
  );
}

const resolveHandoffPlan = Effect.fn('TurnPlan.resolveHandoff')(function* (
  context: TurnContext,
  reason: RunHandoffReason,
  sessionId: string,
  fromProvider: string
) {
  if (!resolveCapabilities(context.provider).contextHandoff) {
    yield* Effect.logWarning('[Runs] The provider takes no context handoff; the step starts fresh').pipe(
      Effect.annotateLogs({ runId: context.run.id, provider: context.provider.id })
    );
    return FRESH;
  }
  const found = resolveHandoff({
    reason,
    fromProvider: context.labelOf(fromProvider),
    sources: yield* listConversation(context, sessionId),
  });
  if (Option.isNone(found)) return FRESH;
  const handoff = found.value;
  const plan: TurnPlan = {
    resume: null,
    fork: false,
    handoff,
    record: {
      reason,
      fromProvider,
      totalEntries: handoff.totalEntries,
      includedEntries: handoff.includedEntries,
      approxTokens: handoff.approxTokens,
    },
  };
  return plan;
});

const inspectSession = Effect.fn('TurnPlan.inspectSession')(function* (
  context: TurnContext,
  sessionId: string
) {
  const { provider } = context;
  const capabilities = resolveCapabilities(provider);
  if (!capabilities.sessions.inspect || !provider.inspectSession) return null;
  const inspect = provider.inspectSession;
  const status = yield* inspect({ cwd: context.cwd, sessionId });
  return status === 'missing' || status === 'empty' ? status : null;
});

const resolveForkPlan = Effect.fn('TurnPlan.resolveFork')(function* (context: TurnContext, fork: RunFork) {
  const { provider } = context;
  const source = context.state.runs[fork.runId];
  const owner = source?.sessionProvider ?? source?.provider ?? provider.id;
  if (owner !== provider.id || !resolveCapabilities(provider).sessions.fork) {
    return yield* resolveHandoffPlan(context, 'fork', fork.sessionId, owner);
  }
  const gone = yield* inspectSession(context, fork.sessionId);
  if (gone === null) return { ...FRESH, resume: fork.sessionId, fork: true };
  yield* Effect.logWarning(
    '[Runs] The session to fork is gone; restoring it from the source task’s transcript'
  ).pipe(
    Effect.annotateLogs({
      runId: context.run.id,
      sourceTaskId: fork.taskId,
      sessionId: fork.sessionId,
      status: gone,
    })
  );
  return yield* resolveHandoffPlan(context, 'fork', fork.sessionId, owner);
});

export const resolveTurnPlan = Effect.fn('TurnPlan.resolve')(function* (context: TurnContext) {
  const { run, provider } = context;
  const sessionId = run.sessionId;
  if (!sessionId) return run.fork ? yield* resolveForkPlan(context, run.fork) : FRESH;
  const owner = run.sessionProvider ?? run.provider;
  if (owner !== provider.id) return yield* resolveHandoffPlan(context, 'provider_switch', sessionId, owner);
  if (run.sessionLost || !resolveCapabilities(provider).sessions.resume) {
    return yield* resolveHandoffPlan(context, 'session_restore', sessionId, owner);
  }
  const gone = yield* inspectSession(context, sessionId);
  if (gone === null) return { ...FRESH, resume: sessionId };
  yield* Effect.logWarning('[Runs] The session to resume is gone; restoring it from the transcript').pipe(
    Effect.annotateLogs({ runId: run.id, sessionId, status: gone })
  );
  yield* context.recordLost(sessionId);
  return yield* resolveHandoffPlan(context, 'session_restore', sessionId, owner);
});

export const resolveRestorePlan = (context: TurnContext, plan: TurnPlan, sessionId: string) =>
  resolveHandoffPlan(context, plan.fork ? 'fork' : 'session_restore', sessionId, context.provider.id);

function readBriefing(entry: ChatEntry, rules: string) {
  if (entry.type === 'notice' && entry.notice.kind === 'compaction')
    return entry.notice.by === 'eunoe' ? null : false;
  if (entry.type === 'user' && entry.from === 'shinsa' && entry.text.includes(rules)) return true;
  return null;
}

const hasHouseRules = Effect.fn('TurnPlan.hasHouseRules')(function* (
  context: TurnContext,
  sessionId: string,
  rules: string
) {
  for (const run of listSessionRuns(context, sessionId).reverse()) {
    for (const entry of (yield* context.transcripts.listEntries(run.id)).reverse()) {
      const briefed = readBriefing(entry, rules);
      if (briefed !== null) return briefed;
    }
  }
  return false;
});

export function resolveTurnBrief(state: ShinsaState, run: Run, override: string | null) {
  const brief = resolveRunBrief(state, run);
  if (override === null) return brief;
  return brief === (run.prompt ?? '') ? override : [brief, override].join('\n\n');
}

const resolveResumedPrompt = Effect.fn('TurnPlan.resolveResumedPrompt')(function* (
  context: TurnContext,
  resume: string,
  prompt: string,
  brief: string
) {
  const split = splitHouseRules(brief);
  if (Option.isNone(split)) return prompt;
  if (!(yield* hasHouseRules(context, resume, split.value.rules))) return brief;
  return Option.getOrUndefined(splitHouseRules(prompt))?.instruction ?? prompt;
});

export function resolveTurnFold({ run, plan, stepPrompt, firstAttempt, folds }: TurnFoldInput) {
  if (!folds || !stepPrompt || !firstAttempt || !plan.resume || plan.fork || plan.handoff) return false;
  if (run.continues) return false;
  return run.role === 'agent' && needsRoundBrief(run);
}

export function isSessionCacheWarm(context: TurnContext, sessionId: string, now: number) {
  const earlier = listSessionRuns(context, sessionId).filter(
    (run) => run.id !== context.run.id && run.cacheExpiresAt !== undefined
  );
  const last = earlier.at(-1);
  if (!last || last.model !== context.run.model) return false;
  return last.cacheExpiresAt !== undefined && now < last.cacheExpiresAt;
}

export const resolveTurnPrompt = Effect.fn('TurnPlan.resolvePrompt')(function* (
  context: TurnContext,
  plan: TurnPlan,
  prompt: string,
  brief: string,
  fold = false
) {
  if (plan.handoff) return resolveHandoffPrompt(plan.handoff.text, brief);
  if (!plan.resume) return brief;
  const turn = yield* resolveResumedPrompt(context, plan.resume, fold ? brief : prompt, brief);
  const started = Option.getOrNull(selectSessionCwd(context.state, plan.resume, context.run.id));
  if (!started || started === context.cwd) return turn;
  return `${turn}\n\n${resolveMovedNote(context.cwd)}`;
});
