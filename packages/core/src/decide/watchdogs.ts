import { describeCount } from '../chat/text.ts';
import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  HOUR_MS,
  isTaskClosed,
  isWatchdogActive,
  isWatchdogScheduled,
  listActiveWatchdogs,
  MINUTE_MS,
  type Run,
  resolveCurrentRound,
  resolveWatchdogDefaults,
  selectWatchingRun,
  type Task,
  WATCHDOG_LIMITS,
  type Watchdog,
  type WatchSource,
} from '../domain/index.ts';
import { resolveAgentPrompt, resolveWatchPrompt } from '../prompts/index.ts';
import { assembleReport } from '../report/assemble.ts';
import type { WatchdogSource, WatchdogSpec } from '../report/types.ts';
import { listChangedIds } from '../state/draft.ts';
import type { Decider } from './decider.ts';
import { settleTask } from './lifecycle.ts';
import { isReadBusy, listSourceFiledTasks, type ReadReport } from './reads.ts';
import { resolveRestingStage } from './shapes.ts';
import { isWatchSuggestible, removeSourceSuggestions } from './watch-suggestions.ts';

function selectWatchdog(task: Task, watchdogId: string) {
  return (task.watchdogs ?? []).find((watchdog) => watchdog.id === watchdogId) ?? null;
}

function findWatchdog(task: Task, watchdogId: string) {
  const watchdog = selectWatchdog(task, watchdogId);
  if (watchdog) return watchdog;
  throw new DomainError('watchdog_not_found', 'That watchdog is no longer there.');
}

function isArmedForRound(task: Task, round: number) {
  return (task.watchdogs ?? []).some((watchdog) => watchdog.round === round);
}

type WatchdogSchedule = Pick<Watchdog, 'firstCheckMinutes' | 'forMinutes' | 'startsOn'>;

function resolveWindowStart(schedule: WatchdogSchedule, now: number) {
  if (schedule.startsOn === 'production') {
    return {
      status: 'awaiting_production' as const,
      awaitingSince: now,
      startedAt: null,
      endsAt: null,
      nextCheckAt: resolveProductionPollAt(now, now),
    };
  }
  return {
    status: 'watching' as const,
    awaitingSince: null,
    startedAt: now,
    endsAt: now + schedule.forMinutes * MINUTE_MS,
    nextCheckAt: now + schedule.firstCheckMinutes * MINUTE_MS,
  };
}

function createWatchdog(decider: Decider, spec: WatchdogSpec, round: number): Watchdog {
  const now = decider.context.now;
  const defaults = resolveWatchdogDefaults(decider.state.settings);
  const schedule = {
    firstCheckMinutes: spec.firstCheckMinutes ?? defaults.firstCheckMinutes,
    maxGapMinutes: (spec.maxGapHours ?? defaults.maxGapHours) * 60,
    forMinutes: (spec.forHours ?? defaults.hours) * 60,
    startsOn: spec.startsOn,
    productionCheck: spec.productionCheck,
  };
  const window = spec.source
    ? resolveWindowStart(schedule, now)
    : {
        status: 'needs_source' as const,
        awaitingSince: null,
        startedAt: null,
        endsAt: null,
        nextCheckAt: null,
      };
  return {
    id: decider.context.newId(),
    round,
    title: spec.title,
    check: spec.check,
    source: spec.source,
    sourceRequest: spec.sourceRequest,
    ...schedule,
    ...window,
    armedAt: now,
    runId: null,
    checks: [],
    forkTaskIds: [],
    linkedTaskIds: [],
    endedAt: null,
  };
}

function writeSource(decider: Decider, projectId: string, source: WatchSource) {
  const project = decider.state.projects[projectId];
  if (!project) throw new DomainError('project_not_found', `No project ${projectId}`);
  const sources = project.watchSources ?? [];
  const known = sources.find((candidate) => candidate.server === source.server);
  if (!known && sources.length >= WATCHDOG_LIMITS.projectSources) {
    throw new DomainError(
      'too_many_sources',
      `A project keeps ${WATCHDOG_LIMITS.projectSources} data sources at most.`
    );
  }
  const repoIds = known ? [...new Set([...known.repoIds, ...source.repoIds])] : source.repoIds;
  const written = { ...source, repoIds: known && known.repoIds.length === 0 ? [] : repoIds };
  if (known && known.data === written.data && known.repoIds.join() === written.repoIds.join()) return;
  decider.emit({ type: 'watch_source.written', projectId, source: written });
  if (known || !isWatchSuggestible(decider, projectId, written.server)) return;
  decider.run({ kind: 'watch.suggest', projectId, server: written.server, data: written.data });
}

function recordAgentSource(decider: Decider, task: Task, source: WatchdogSource) {
  const project = decider.projectOf(task);
  if (!project) return;
  const known = (project.watchSources ?? []).find((candidate) => candidate.server === source.server);
  if (known && (known.repoIds.length === 0 || (task.repoId && known.repoIds.includes(task.repoId)))) return;
  if (!known && (project.watchSources ?? []).length >= WATCHDOG_LIMITS.projectSources) return;
  writeSource(decider, project.id, {
    server: source.server,
    data: known?.data ?? source.data,
    repoIds: task.repoId ? [task.repoId] : [],
    addedBy: known?.addedBy ?? 'agent',
    addedAt: known?.addedAt ?? decider.context.now,
  });
}

function armWatchdogs(decider: Decider, task: Task) {
  if (task.pullRequest?.state !== 'merged' || isTaskClosed(task)) return;
  const specs = assembleReport(task).walkthrough?.watchdogs ?? [];
  const round = resolveCurrentRound(task).number;
  if (specs.length === 0 || isArmedForRound(task, round)) return;
  for (const spec of specs) {
    decider.emit({ type: 'watchdog.armed', taskId: task.id, watchdog: createWatchdog(decider, spec, round) });
    if (spec.source) recordAgentSource(decider, decider.task(task.id), spec.source);
  }
}

export function syncWatchdogs(decider: Decider) {
  for (const id of listChangedIds(decider.state, 'tasks')) {
    const task = decider.state.tasks[id];
    if (task) armWatchdogs(decider, task);
  }
}

function startCheck(decider: Decider, task: Task, watchdog: Watchdog, guidance: string | null) {
  if (task.recoveries > 0) decider.emit({ type: 'task.recovered', taskId: task.id, recoveries: 0 });
  decider.stage(task.id, 'watching', `checking the watchdog “${watchdog.title}”`);
  const hint = guidance ? `\n\nThe human added: ${guidance}` : '';
  const filed = listSourceFiledTasks(decider, task.projectId ?? null, watchdog.source?.server ?? '');
  const prompt = resolveAgentPrompt(
    `${resolveWatchPrompt(task, watchdog, decider.context.now, filed)}${hint}`
  );
  const run = decider.startRun(decider.task(task.id), 'agent', prompt, {
    purpose: 'watch',
    resumeFrom: decider.taskSession(task.id, 'agent', 'watch'),
  });
  decider.emit({ type: 'watchdog.checking', taskId: task.id, watchdogId: watchdog.id, runId: run.id });
}

export function fireWatchdog(decider: Decider, command: CommandOf<'watchdog.fire'>) {
  const task = decider.state.tasks[command.taskId];
  const watchdog = task ? selectWatchdog(task, command.watchdogId) : null;
  if (!task || !watchdog || !isWatchdogScheduled(watchdog) || watchdog.runId !== null) return;
  if (watchdog.nextCheckAt !== command.dueAt || isTaskClosed(task)) return;
  const now = decider.context.now;
  const late = watchdog.endsAt !== null && command.dueAt > watchdog.endsAt;
  if (isReadBusy(decider, task) && late) {
    decider.emit({
      type: 'watchdog.missed',
      taskId: task.id,
      watchdogId: watchdog.id,
      reason: 'The task was still at work when the window ended, so its last check never ran.',
      nextCheckAt: null,
    });
    return;
  }
  if (isReadBusy(decider, task)) {
    decider.emit({
      type: 'watchdog.deferred',
      taskId: task.id,
      watchdogId: watchdog.id,
      nextCheckAt: now + WATCHDOG_LIMITS.deferMinutes * MINUTE_MS,
    });
    return;
  }
  startCheck(decider, task, watchdog, null);
}

function resolveNextGapMinutes(watchdog: Watchdog) {
  const doubled = watchdog.firstCheckMinutes * 2 ** (watchdog.checks.length + 1);
  return Math.min(doubled, watchdog.maxGapMinutes);
}

function resolveProductionPollAt(awaitingSince: number, now: number) {
  const least = WATCHDOG_LIMITS.productionPollMinutes * MINUTE_MS;
  const most = WATCHDOG_LIMITS.productionPollMaxMinutes * MINUTE_MS;
  return now + Math.min(Math.max(now - awaitingSince, least), most);
}

function resolveNextCheckAt(watchdog: Watchdog, now: number) {
  if (watchdog.status === 'awaiting_production') {
    return resolveProductionPollAt(watchdog.awaitingSince ?? now, now);
  }
  const next = now + resolveNextGapMinutes(watchdog) * MINUTE_MS;
  return watchdog.endsAt !== null && next > watchdog.endsAt ? null : next;
}

function hasWaitedTooLong(watchdog: Watchdog, now: number) {
  return now - (watchdog.awaitingSince ?? now) >= WATCHDOG_LIMITS.productionWaitHours * HOUR_MS;
}

function listAwaitingProduction(task: Task) {
  return (task.watchdogs ?? []).filter((watchdog) => watchdog.status === 'awaiting_production');
}

function awaitProductionFor(decider: Decider, task: Task, watchdog: Watchdog) {
  const now = decider.context.now;
  if (hasWaitedTooLong(watchdog, now)) {
    decider.emit({
      type: 'watchdog.missed',
      taskId: task.id,
      watchdogId: watchdog.id,
      reason: `The change did not reach production within ${WATCHDOG_LIMITS.productionWaitHours} hours, so the watchdog stopped waiting.`,
      nextCheckAt: null,
    });
    return;
  }
  decider.emit({
    type: 'watchdog.deferred',
    taskId: task.id,
    watchdogId: watchdog.id,
    nextCheckAt: resolveNextCheckAt(watchdog, now) ?? now,
  });
}

function awaitProduction(decider: Decider, task: Task, runId: string) {
  const run = decider.state.runs[runId];
  for (const watchdog of listAwaitingProduction(task)) awaitProductionFor(decider, task, watchdog);
  if (run) decider.endRun(run, 'completed', 'The change is not live in production yet.');
  decider.progressed(task.id);
  settleTask(decider, task.id, resolveRestingStage(decider.task(task.id)), 'waiting for production');
}

function startLiveWindow(decider: Decider, task: Task, watchdog: Watchdog) {
  const now = decider.context.now;
  for (const waiting of listAwaitingProduction(task)) {
    decider.emit({
      type: 'watchdog.live',
      taskId: task.id,
      watchdogId: waiting.id,
      endsAt: now + waiting.forMinutes * MINUTE_MS,
      nextCheckAt: now + waiting.firstCheckMinutes * MINUTE_MS,
    });
  }
  return findWatchdog(decider.task(task.id), watchdog.id);
}

function listFiledTaskIds(decider: Decider, watchdog: Watchdog) {
  return Object.values(decider.state.tasks)
    .filter((candidate) => candidate.sourceReport?.watchdogId === watchdog.id)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((candidate) => candidate.id);
}

function hasFoundReports(filed: readonly string[], watchdog: Watchdog) {
  return filed.length > 0 || watchdog.linkedTaskIds.length > 0;
}

function resolveLive(read: ReadReport, found: boolean) {
  if (found && read.live === false) {
    throw new DomainError(
      'live_filed',
      'You filed a report on the change, so it is live in production. Set `live` true.'
    );
  }
  const live = read.live ?? (found ? true : null);
  if (live === null && read.reached) {
    throw new DomainError(
      'live_required',
      'This watchdog waits for the change to reach production. Report `live`: true once it is live there, false while it is not.'
    );
  }
  return live;
}

function recordTrip(decider: Decider, task: Task, watchdog: Watchdog, summary: string, filed: string[]) {
  decider.emit({
    type: 'watchdog.checked',
    taskId: task.id,
    watchdogId: watchdog.id,
    check: { at: decider.context.now, healthy: false, summary },
    status: 'tripped',
    nextCheckAt: null,
    forkTaskIds: filed,
  });
}

function recordMiss(decider: Decider, task: Task, watchdog: Watchdog, reason: string) {
  decider.emit({
    type: 'watchdog.missed',
    taskId: task.id,
    watchdogId: watchdog.id,
    reason,
    nextCheckAt: resolveNextCheckAt(watchdog, decider.context.now),
  });
}

function describeTripRun(filed: readonly string[], watchdog: Watchdog) {
  if (filed.length > 0) return `Filed ${describeCount(filed.length, 'report')} on the change.`;
  return `Found ${describeCount(watchdog.linkedTaskIds.length, 'report')} on the change already filed.`;
}

function recordCheck(decider: Decider, task: Task, run: Run, watchdog: Watchdog, read: ReadReport) {
  const filed = listFiledTaskIds(decider, watchdog);
  if (hasFoundReports(filed, watchdog)) {
    recordTrip(decider, task, watchdog, read.summary, filed);
    decider.endRun(run, 'completed', describeTripRun(filed, watchdog));
    return 'checked a watchdog';
  }
  if (!read.reached) {
    recordMiss(decider, task, watchdog, read.summary);
    decider.endRun(run, 'failed', read.summary);
    return 'could not check a watchdog';
  }
  const now = decider.context.now;
  const nextCheckAt = resolveNextCheckAt(watchdog, now);
  decider.emit({
    type: 'watchdog.checked',
    taskId: task.id,
    watchdogId: watchdog.id,
    check: { at: now, healthy: true, summary: read.summary },
    status: nextCheckAt === null ? 'passed' : 'watching',
    nextCheckAt,
    forkTaskIds: [],
  });
  decider.endRun(run, 'completed', 'The watchdog found nothing wrong.');
  return 'checked a watchdog';
}

function resolveCheckedWatchdog(decider: Decider, task: Task, found: Watchdog, read: ReadReport) {
  if (found.status !== 'awaiting_production') return found;
  const live = resolveLive(read, hasFoundReports(listFiledTaskIds(decider, found), found));
  if (live === null) return found;
  if (!live) return null;
  return startLiveWindow(decider, task, found);
}

export function endWatchCheck(decider: Decider, task: Task, run: Run, read: ReadReport) {
  const found = selectWatchingRun(task, run.id);
  if (!found) throw new DomainError('watchdog_not_found', 'No watchdog waits on this check. End your turn.');
  const watchdog = resolveCheckedWatchdog(decider, task, found, read);
  if (!watchdog) {
    awaitProduction(decider, task, run.id);
    return;
  }
  const reason = recordCheck(decider, task, run, watchdog, read);
  decider.progressed(task.id);
  settleTask(decider, task.id, resolveRestingStage(decider.task(task.id)), reason);
}

export function moveWatchCheck(decider: Decider, from: string, to: string) {
  const task = decider.task(decider.state.runs[to]?.taskId ?? '');
  const watchdog = selectWatchingRun(task, from);
  if (!watchdog) return;
  decider.emit({ type: 'watchdog.checking', taskId: task.id, watchdogId: watchdog.id, runId: to });
}

export function missWatchCheck(decider: Decider, runId: string, reason: string) {
  const task = decider.task(decider.state.runs[runId]?.taskId ?? '');
  const watchdog = selectWatchingRun(task, runId);
  if (!watchdog) return false;
  const filed = listFiledTaskIds(decider, watchdog);
  if (hasFoundReports(filed, watchdog)) recordTrip(decider, task, watchdog, reason, filed);
  else recordMiss(decider, task, watchdog, reason);
  settleTask(decider, task.id, resolveRestingStage(decider.task(task.id)), 'could not check a watchdog');
  return true;
}

function endCheckRun(decider: Decider, task: Task, watchdog: Watchdog) {
  if (watchdog.runId === null || task.stage !== 'watching') return;
  settleTask(decider, task.id, resolveRestingStage(task), 'stopped a watchdog');
}

export function stopWatchdog(decider: Decider, command: CommandOf<'watchdog.stop'>) {
  const task = decider.task(command.taskId);
  const watchdog = findWatchdog(task, command.watchdogId);
  if (!isWatchdogActive(watchdog)) return;
  endCheckRun(decider, task, watchdog);
  decider.emit({ type: 'watchdog.ended', taskId: task.id, watchdogId: watchdog.id });
}

export function stopAllWatchdogs(decider: Decider, taskId: string) {
  for (const watchdog of listActiveWatchdogs(decider.task(taskId))) {
    decider.emit({ type: 'watchdog.ended', taskId, watchdogId: watchdog.id });
  }
}

export function assertNoWatchdogsLeft(task: Task) {
  const active = listActiveWatchdogs(task);
  if (active.length === 0) return;
  throw new DomainError(
    'task_open',
    `${describeCount(active.length, 'watchdog still watches', 'watchdogs still watch')} it.`
  );
}

export function connectWatchdog(decider: Decider, command: CommandOf<'watchdog.connect'>) {
  const task = decider.task(command.taskId);
  const watchdog = findWatchdog(task, command.watchdogId);
  if (watchdog.status !== 'needs_source') {
    throw new DomainError('watchdog_has_source', 'It already has a data source.');
  }
  const source = { server: command.server.trim(), data: command.data.trim() };
  const project = decider.projectOf(task);
  if (project) {
    writeSource(decider, project.id, {
      ...source,
      repoIds: task.repoId ? [task.repoId] : [],
      addedBy: 'you',
      addedAt: decider.context.now,
    });
  }
  decider.emit({
    type: 'watchdog.started',
    taskId: task.id,
    watchdogId: watchdog.id,
    source,
    ...resolveWindowStart(watchdog, decider.context.now),
  });
}

export function writeWatchSource(decider: Decider, command: CommandOf<'watch_source.write'>) {
  for (const repoId of command.repoIds) {
    if (!decider.state.repos[repoId]) throw new DomainError('repo_not_found', `No repository ${repoId}`);
  }
  const known = decider.state.projects[command.projectId]?.watchSources?.find(
    (source) => source.server === command.server
  );
  writeSource(decider, command.projectId, {
    server: command.server.trim(),
    data: command.data.trim(),
    repoIds: command.repoIds,
    addedBy: 'you',
    addedAt: known?.addedAt ?? decider.context.now,
  });
}

export function removeWatchSource(decider: Decider, command: CommandOf<'watch_source.remove'>) {
  const project = decider.state.projects[command.projectId];
  if (!project) throw new DomainError('project_not_found', `No project ${command.projectId}`);
  if (!(project.watchSources ?? []).some((source) => source.server === command.server)) return;
  removeSourceSuggestions(decider, project.id, command.server);
  decider.emit({ type: 'watch_source.removed', projectId: project.id, server: command.server });
}

export function restartWatchCheck(decider: Decider, task: Task, guidance: string | null) {
  const watchdog = (task.watchdogs ?? []).find((candidate) => candidate.runId !== null);
  if (!watchdog) {
    settleTask(decider, task.id, resolveRestingStage(task), 'no watchdog to check');
    return;
  }
  startCheck(decider, task, watchdog, guidance);
}
