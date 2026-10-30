import { describeCount } from '../chat/text.ts';
import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  HOUR_MS,
  isTaskClosed,
  isTaskResting,
  isWatchdogActive,
  isWatchdogScheduled,
  listActiveWatchdogs,
  MINUTE_MS,
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
import type { WatchdogSource, WatchdogSpec, WatchIssue } from '../report/types.ts';
import { listChangedIds } from '../state/draft.ts';
import { listLiveRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { settleTask } from './lifecycle.ts';
import { findCurrentRun } from './runs.ts';
import { resolveRestingStage } from './shapes.ts';
import { createTask } from './tasks.ts';
import { isWatchSuggestible, removeSourceSuggestions } from './watch-suggestions.ts';

function selectWatchdog(task: Task, watchdogId: string) {
  return (task.watchdogs ?? []).find((watchdog) => watchdog.id === watchdogId) ?? null;
}

function findWatchdog(task: Task, watchdogId: string) {
  const watchdog = selectWatchdog(task, watchdogId);
  if (watchdog) return watchdog;
  throw new DomainError('watchdog_not_found', 'This task has no such watchdog. Read the task again.');
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
    forkTaskId: null,
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
      `A project keeps at most ${WATCHDOG_LIMITS.projectSources} data sources. Remove one first.`
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
  decider.stage(task.id, 'watching', `checking the watchdog “${watchdog.title}”`);
  const hint = guidance ? `\n\nThe human added: ${guidance}` : '';
  const prompt = resolveAgentPrompt(`${resolveWatchPrompt(task, watchdog, decider.context.now)}${hint}`);
  const run = decider.startRun(decider.task(task.id), 'agent', prompt, {
    purpose: 'watch',
    resumeFrom: decider.taskSession(task.id, 'agent'),
  });
  decider.emit({ type: 'watchdog.checking', taskId: task.id, watchdogId: watchdog.id, runId: run.id });
}

function canCheckNow(decider: Decider, task: Task) {
  return isTaskResting(task) && listLiveRuns(decider.state, task.id).length === 0;
}

export function fireWatchdog(decider: Decider, command: CommandOf<'watchdog.fire'>) {
  const task = decider.state.tasks[command.taskId];
  const watchdog = task ? selectWatchdog(task, command.watchdogId) : null;
  if (!task || !watchdog || !isWatchdogScheduled(watchdog) || watchdog.runId !== null) return;
  if (watchdog.nextCheckAt !== command.dueAt || isTaskClosed(task)) return;
  const now = decider.context.now;
  const late = watchdog.endsAt !== null && command.dueAt > watchdog.endsAt;
  if (!canCheckNow(decider, task) && late) {
    decider.emit({
      type: 'watchdog.missed',
      taskId: task.id,
      watchdogId: watchdog.id,
      reason: 'The task was still at work when the window ended, so its last check never ran.',
      nextCheckAt: null,
    });
    return;
  }
  if (!canCheckNow(decider, task)) {
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

function forkIssue(decider: Decider, task: Task, watchdog: Watchdog, runId: string, issue: WatchIssue) {
  const request = [
    issue.title,
    '',
    issue.request,
    '',
    `Found by the watchdog “${watchdog.title}” of ${task.handle ?? task.title} after its change merged.`,
  ].join('\n');
  return createTask(
    decider,
    {
      type: 'task.create',
      request,
      repoId: task.repoId,
      priority: task.priority,
      origin: task.origin,
      forkOf: task.id,
    },
    { createdBy: { kind: 'watchdog', taskId: task.id, runId, requestKey: watchdog.id } }
  );
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

function resolveCheckedWatchdog(
  decider: Decider,
  task: Task,
  found: Watchdog,
  command: CommandOf<'agent.report_watch'>
) {
  if (found.status !== 'awaiting_production') return found;
  if (command.live === undefined || command.live === null) {
    throw new DomainError(
      'live_required',
      'This watchdog waits for the change to reach production. Report `live`: true once it is live there, false while it is not.'
    );
  }
  if (!command.live) return null;
  return startLiveWindow(decider, task, found);
}

export function reportWatch(decider: Decider, command: CommandOf<'agent.report_watch'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'report_watch');
  const found = selectWatchingRun(task, run.id);
  if (!found) throw new DomainError('watchdog_not_found', 'No watchdog waits on this check. End your turn.');
  const watchdog = resolveCheckedWatchdog(decider, task, found, command);
  if (!watchdog) {
    awaitProduction(decider, task, run.id);
    return;
  }
  const now = decider.context.now;
  const check = { at: now, healthy: command.healthy, summary: command.summary };
  const issue = command.issue;
  const forkTaskId = issue ? forkIssue(decider, task, watchdog, run.id, issue) : null;
  const nextCheckAt = issue ? null : resolveNextCheckAt(watchdog, now);
  decider.emit({
    type: 'watchdog.checked',
    taskId: task.id,
    watchdogId: watchdog.id,
    check,
    status: issue ? 'tripped' : nextCheckAt === null ? 'passed' : 'watching',
    nextCheckAt,
    forkTaskId,
  });
  decider.endRun(
    run,
    'completed',
    issue ? `Found an issue: ${issue.title}` : 'The watchdog found nothing wrong.'
  );
  decider.progressed(task.id);
  settleTask(decider, task.id, resolveRestingStage(decider.task(task.id)), 'checked a watchdog');
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
  decider.emit({
    type: 'watchdog.missed',
    taskId: task.id,
    watchdogId: watchdog.id,
    reason,
    nextCheckAt: resolveNextCheckAt(watchdog, decider.context.now),
  });
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
    `${describeCount(active.length, 'watchdog still watches', 'watchdogs still watch')} this task's change. Leave it open until they finish, or tell the human.`
  );
}

export function connectWatchdog(decider: Decider, command: CommandOf<'watchdog.connect'>) {
  const task = decider.task(command.taskId);
  const watchdog = findWatchdog(task, command.watchdogId);
  if (watchdog.status !== 'needs_source') {
    throw new DomainError('watchdog_has_source', 'This watchdog already has its data source.');
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
