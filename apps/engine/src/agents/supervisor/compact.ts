import { isReadOnlyRun } from '@shinsa/core';
import { Effect } from 'effect';
import { resolveCapabilities } from '../providers/index.ts';
import { createShinsaTools } from '../tools/index.ts';
import { ToolCallFailed } from '../tools/schema.ts';
import { meter } from './meter.ts';
import { COMPACT_ONLY } from './schema.ts';
import { readSessionUsage, resolveSpeed, stopSession } from './session.ts';
import { prepareWorkspace, resolveWorkspace } from './workspace.ts';
import { RunWorld } from './world/service.ts';

export const compactSession = Effect.fn('RunSupervisor.compact')(function* (
  runId: string,
  sessionId: string
) {
  const world = yield* RunWorld;
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  const state = yield* world.state;
  const run = state.runs[runId];
  const task = run ? state.tasks[run.taskId] : undefined;
  const provider = run ? world.providers.select(run.sessionProvider ?? run.provider) : null;
  const workspace = run && task ? resolveWorkspace(state, world.config, run, task) : null;
  const start = provider?.compactSession;
  if (!run || !workspace || !provider || !start || !resolveCapabilities(provider).compaction) return;
  const id = `idle-compact:${runId}:${sessionId}`;
  const events = yield* world.dispatch({ type: 'run.compact', runId, sessionId }, { id });
  if (!events.some((event) => event.type === 'run.compacted')) return;
  const lease = yield* world.leasing.leaseSession(run);
  yield* Effect.logInfo('[Runs] Compacting an idle session before its prompt cache expires').pipe(
    Effect.annotateLogs({ runId, sessionId })
  );
  const { cwd } = yield* prepareWorkspace(workspace);
  const speed = yield* resolveSpeed(run, provider, lease, false);
  const usageBaseline = yield* readSessionUsage();
  const session = yield* start({
    role: run.role,
    readOnly: isReadOnlyRun(run),
    cwd,
    model: run.attempts?.at(-1)?.model ?? run.model,
    resume: sessionId,
    defaultBranch: workspace.defaultBranch,
    pluginDir: world.config.pluginDir,
    tools: yield* createShinsaTools(run.role, () =>
      Effect.fail(new ToolCallFailed({ message: COMPACT_ONLY }))
    ),
    ...speed,
    ...(lease ? { account: { id: lease.id, configDir: lease.configDir } } : {}),
    usageBaseline,
    onSession: () => undefined,
    onEntry: (entry) => {
      if (entry.type === 'notice' && entry.notice.kind === 'compaction')
        runSync(world.transcripts.record(runId, entry));
    },
  });
  const result = yield* session.done.pipe(
    Effect.onInterrupt(() => stopSession(runId, session, '[Runs] Could not stop a compaction'))
  );
  if (result.usage) yield* meter(runId, sessionId, result.usage, `${id}:run.meter`);
}, Effect.scoped);
