import type { CommandOf } from '../commands/index.ts';
import type { ScheduleTargetInput } from '../commands/schedules.ts';
import {
  DomainError,
  isScheduleLive,
  isTaskClosed,
  isTaskSettled,
  MINUTE_MS,
  type Run,
  SCHEDULE_LIMITS,
  type Schedule,
  type ScheduleCreator,
  type ScheduleRun,
  type ScheduleSource,
  type ScheduleTarget,
  type ScheduleTrigger,
  type Task,
} from '../domain/index.ts';
import { isTimeZone, parseTimeOfDay, resolveFirstRun, resolveNextRun } from '../schedules/time.ts';
import { listActiveRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { isSameValue } from './equality.ts';
import {
  closeWatchHome,
  createWatchHome,
  findProjectSource,
  isIntakeBusy,
  selectProjectSource,
  startIntake,
} from './intake.ts';
import { assertNotWatchHome, messageTask } from './messages.ts';
import { findCurrentRun } from './runs.ts';
import { createTask } from './tasks.ts';
import { findOpenWatchSuggestion, suggestWatch, type WatchSuggestionInput } from './watch-suggestions.ts';

const NAME_FROM_TEXT = 60;

const HEADER_NAME = /^[A-Za-z0-9-]+$/;

const PLACEHOLDER = /\{\{[^{}]+\}\}/;

const STILL_LIVE = 'The last run was still going, so this one was skipped.';

const INTAKE_BUSY = 'The task was at work, so this read was skipped.';

interface Delivery {
  text: string;
  deliveryId: string | null;
  replayKey: string | null;
  skipWhenLive: boolean;
}

function assertInteger(value: number, min: number, max: number, message: string) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new DomainError('schedule_invalid', message);
}

function assertWebhook(trigger: Extract<ScheduleTrigger, { kind: 'webhook' }>) {
  const signature = trigger.signature;
  if (signature) {
    if (!HEADER_NAME.test(signature.header) || signature.header.length > SCHEDULE_LIMITS.header) {
      throw new DomainError('schedule_invalid', 'Name the signature header with letters, digits and dashes.');
    }
    if (signature.prefix.length > SCHEDULE_LIMITS.prefix) {
      throw new DomainError(
        'schedule_invalid',
        `The signature prefix can be at most ${SCHEDULE_LIMITS.prefix} characters.`
      );
    }
  }
  const replayKey = trigger.replayKey;
  if (replayKey !== null && (replayKey.length > SCHEDULE_LIMITS.replayKey || !PLACEHOLDER.test(replayKey))) {
    throw new DomainError(
      'schedule_invalid',
      'The replay key must name a part of the request, such as {{headers.x-github-delivery}}.'
    );
  }
}

function assertTrigger(trigger: ScheduleTrigger, now: number) {
  switch (trigger.kind) {
    case 'once':
      if (trigger.at < now - SCHEDULE_LIMITS.onceGraceMs) {
        throw new DomainError(
          'schedule_past',
          'That time has already passed, so the schedule would never run.'
        );
      }
      if (trigger.at > now + SCHEDULE_LIMITS.maxInMinutes * MINUTE_MS) {
        throw new DomainError('schedule_invalid', 'A schedule can run at most a year from now.');
      }
      return;
    case 'interval':
      assertInteger(
        trigger.everyMinutes,
        SCHEDULE_LIMITS.minEveryMinutes,
        SCHEDULE_LIMITS.maxEveryMinutes,
        `Run it every 1 to ${SCHEDULE_LIMITS.maxEveryMinutes} minutes.`
      );
      return;
    case 'daily':
      if (!parseTimeOfDay(trigger.time)) {
        throw new DomainError(
          'schedule_invalid',
          `“${trigger.time}” is not a time of day. Use 24-hour HH:MM, such as 09:00.`
        );
      }
      if (
        new Set(trigger.weekdays).size !== trigger.weekdays.length ||
        trigger.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
      ) {
        throw new DomainError(
          'schedule_invalid',
          'Weekdays are different numbers from 0 (Sunday) to 6 (Saturday).'
        );
      }
      return;
    case 'webhook':
      assertWebhook(trigger);
      return;
  }
}

function assertTimeZone(timeZone: string) {
  if (!isTimeZone(timeZone)) {
    throw new DomainError(
      'time_zone_invalid',
      `“${timeZone}” is not a time zone. Use a name such as Europe/Berlin.`
    );
  }
}

function resolveTarget(decider: Decider, input: ScheduleTargetInput, task: Task): ScheduleTarget {
  if (input.kind === 'new_task') {
    return { kind: 'new_task', repoId: task.repoId, priority: input.priority, mode: input.mode };
  }
  const target = decider.state.tasks[input.taskId ?? task.id];
  if (!target)
    throw new DomainError('task_not_found', `No task ${input.taskId}. find_tasks lists the tasks.`);
  assertNotWatchHome(target);
  if (isTaskClosed(target)) {
    throw new DomainError(
      'task_settled',
      `“${target.title}” is closed, so a message would never be read. Start a new task on each run instead.`
    );
  }
  return { kind: 'task', taskId: target.id };
}

function selectOwnSchedule(decider: Decider, scheduleId: string, task: Task) {
  const schedule = decider.state.schedules[scheduleId];
  if (!schedule) {
    throw new DomainError(
      'schedule_not_found',
      `No schedule ${scheduleId}. list_schedules shows the schedules that exist.`
    );
  }
  if (schedule.createdBy.kind !== 'agent' || schedule.createdBy.taskId !== task.id) {
    throw new DomainError(
      'schedule_not_yours',
      'That schedule belongs to another task. The human can change it in Settings → Schedules.'
    );
  }
  return schedule;
}

function assertScheduleRoom(decider: Decider, task: Task | null) {
  const live = Object.values(decider.state.schedules).filter(isScheduleLive);
  const own = live.filter(
    (schedule) => schedule.createdBy.kind === 'agent' && schedule.createdBy.taskId === task?.id
  );
  if (own.length >= SCHEDULE_LIMITS.perTask || live.length >= SCHEDULE_LIMITS.live) {
    throw new DomainError(
      'schedule_limit',
      'There are already as many schedules as Shinsa keeps. Delete one you no longer need first.'
    );
  }
}

function resolveName(name: string | null, text: string) {
  const fromText = text.split('\n', 1)[0]?.trim().slice(0, NAME_FROM_TEXT) ?? '';
  return (name?.trim() || fromText || 'Schedule').slice(0, SCHEDULE_LIMITS.name);
}

type ScheduleBody = Pick<
  Schedule,
  'name' | 'text' | 'trigger' | 'target' | 'source' | 'enabled' | 'maxRuns' | 'timeZone'
>;

type ScheduleWrite = Pick<
  CommandOf<'agent.set_schedule'>,
  'name' | 'text' | 'trigger' | 'enabled' | 'maxRuns' | 'timeZone'
>;

function resolveText(command: ScheduleWrite, existing: Schedule | null) {
  const text = command.text?.trim() || existing?.text;
  if (!text) throw new DomainError('schedule_invalid', 'A schedule needs a message to send.');
  if (text.length > SCHEDULE_LIMITS.text) {
    throw new DomainError(
      'schedule_invalid',
      `The message is ${text.length} characters; the limit is ${SCHEDULE_LIMITS.text}.`
    );
  }
  return text;
}

function resolveTrigger(command: ScheduleWrite, existing: Schedule | null, now: number) {
  if (command.trigger) {
    assertTrigger(command.trigger, now);
    return command.trigger;
  }
  if (existing) return existing.trigger;
  throw new DomainError(
    'schedule_invalid',
    'Say when it runs: in_minutes, run_at, every_minutes, daily_at or webhook.'
  );
}

function resolveMaxRuns(command: ScheduleWrite, existing: Schedule | null) {
  const maxRuns = command.maxRuns ?? existing?.maxRuns ?? null;
  if (maxRuns !== null) {
    assertInteger(maxRuns, 1, SCHEDULE_LIMITS.maxRuns, `max_runs is 1 to ${SCHEDULE_LIMITS.maxRuns}.`);
  }
  return maxRuns;
}

function resolveWrittenName(command: ScheduleWrite, existing: Schedule | null, text: string) {
  const named = command.name?.trim() ? resolveName(command.name, text) : existing?.name;
  return named ?? resolveName(null, text);
}

function assertSourceChange(source: ScheduleSource | null, existing: Schedule | null, targeted: boolean) {
  if (!source) return;
  if (targeted) {
    throw new DomainError(
      'source_target',
      'A watch reads in a home of its own, never in a task. Leave the target out.'
    );
  }
  if (existing && !existing.source) {
    throw new DomainError(
      'source_change',
      'This automation starts or messages a task, so it cannot become a watch. Create a new one that reads the integration.'
    );
  }
}

function resolveSourceTarget(
  decider: Decider,
  command: ScheduleWrite,
  existing: Schedule | null,
  source: ScheduleSource
) {
  if (existing) return existing.target;
  return createWatchHome(decider, source, resolveWrittenName(command, null, resolveText(command, null)));
}

function resolveWrittenBody(
  decider: Decider,
  command: ScheduleWrite,
  existing: Schedule | null,
  target: ScheduleTarget,
  source: ScheduleSource | null
): ScheduleBody {
  const text = resolveText(command, existing);
  return {
    name: resolveWrittenName(command, existing, text),
    text,
    trigger: resolveTrigger(command, existing, decider.context.now),
    target,
    source,
    enabled: command.enabled ?? existing?.enabled ?? true,
    maxRuns: resolveMaxRuns(command, existing),
    timeZone: command.timeZone,
  };
}

function resolveBody(
  decider: Decider,
  command: CommandOf<'agent.set_schedule'>,
  task: Task,
  existing: Schedule | null
): ScheduleBody {
  const source = resolveAgentSource(decider, command, task, existing);
  assertSourceChange(source, existing, command.target !== null);
  if (source)
    return resolveWrittenBody(
      decider,
      command,
      existing,
      resolveSourceTarget(decider, command, existing, source),
      source
    );
  const target = command.target ? resolveTarget(decider, command.target, task) : existing?.target;
  return resolveWrittenBody(decider, command, existing, target ?? { kind: 'task', taskId: task.id }, null);
}

function resolveAgentSource(
  decider: Decider,
  command: CommandOf<'agent.set_schedule'>,
  task: Task,
  existing: Schedule | null
) {
  const server = command.source?.trim();
  if (!server) return existing?.source ?? null;
  if (!task.projectId) {
    throw new DomainError(
      'project_required',
      'This task belongs to no project, so it has no integration to watch. Ask the human to add one in Settings → Projects.'
    );
  }
  const source = { projectId: task.projectId, server };
  findProjectSource(decider, source);
  return source;
}

function isNewTrigger(existing: Schedule | null, body: ScheduleBody) {
  return !existing || !isSameValue(body.trigger, existing.trigger);
}

function isRestart(existing: Schedule | null, body: ScheduleBody) {
  return isNewTrigger(existing, body) || (body.enabled && existing?.enabled === false);
}

function resolveRestart(existing: Schedule | null, body: ScheduleBody, now: number) {
  if (isNewTrigger(existing, body)) return resolveFirstRun(body.trigger, now, body.timeZone);
  return resolveNextRun(body.trigger, now, body.timeZone);
}

function createDraft(
  decider: Decider,
  body: ScheduleBody,
  createdBy: ScheduleCreator
): Omit<Schedule, 'nextRunAt'> {
  const now = decider.context.now;
  return {
    id: decider.context.newId(),
    ...body,
    runCount: 0,
    runs: [],
    createdAt: now,
    updatedAt: now,
    createdBy,
    lastTaskId: null,
    lastRunId: null,
    lastReadAt: null,
    stopped: null,
    replayKeys: {},
  };
}

function assertRunnable(schedule: Schedule) {
  if (!schedule.enabled) return;
  if (schedule.trigger.kind !== 'webhook' && schedule.nextRunAt === null) {
    throw new DomainError('schedule_past', 'That time has already passed, so the schedule would never run.');
  }
  if (schedule.maxRuns !== null && schedule.runCount >= schedule.maxRuns) {
    throw new DomainError(
      'schedule_invalid',
      `It has already run ${schedule.runCount} times. Raise max_runs to run it again.`
    );
  }
}

function emitWritten(
  decider: Decider,
  existing: Schedule | null,
  body: ScheduleBody,
  createdBy: ScheduleCreator
) {
  const now = decider.context.now;
  const restart = isRestart(existing, body);
  const draft = existing
    ? { ...existing, ...body, updatedAt: now, stopped: restart ? null : existing.stopped }
    : createDraft(decider, body, createdBy);
  const nextRunAt = restart ? resolveRestart(existing, body, now) : (existing?.nextRunAt ?? null);
  const schedule: Schedule = { ...draft, nextRunAt };
  assertRunnable(schedule);
  if (existing && isSameValue({ ...existing, updatedAt: now }, schedule)) return existing;
  decider.emit({ type: 'schedule.written', schedule });
  return schedule;
}

function resolveSuggestion(
  decider: Decider,
  command: ScheduleWrite,
  source: ScheduleSource,
  origin: WatchSuggestionInput['origin']
): WatchSuggestionInput {
  findProjectSource(decider, source);
  const text = resolveText(command, null);
  return {
    projectId: source.projectId,
    server: source.server,
    name: resolveWrittenName(command, null, text),
    text,
    trigger: resolveTrigger(command, null, decider.context.now),
    timeZone: command.timeZone,
    maxRuns: resolveMaxRuns(command, null),
    origin,
  };
}

export function writeSchedule(decider: Decider, command: CommandOf<'agent.set_schedule'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'set_schedule');
  assertTimeZone(command.timeZone);
  const existing = command.scheduleId ? selectOwnSchedule(decider, command.scheduleId, task) : null;
  if (!existing && command.source?.trim()) {
    const source = resolveAgentSource(decider, command, task, null);
    assertSourceChange(source, null, command.target !== null);
    if (source) {
      const origin = { kind: 'agent' as const, taskId: task.id, runId: run.id };
      suggestWatch(decider, resolveSuggestion(decider, command, source, origin));
      return;
    }
  }
  if (!existing) assertScheduleRoom(decider, task);
  const body = resolveBody(decider, command, task, existing);
  emitWritten(decider, existing, body, { kind: 'agent', taskId: task.id, runId: run.id });
}

function resolveUserTarget(decider: Decider, target: ScheduleTarget): ScheduleTarget {
  if (target.kind === 'new_task') {
    if (target.repoId !== null && !decider.state.repos[target.repoId]) {
      throw new DomainError('repo_not_found', `No repository ${target.repoId}.`);
    }
    return target;
  }
  const task = decider.state.tasks[target.taskId];
  if (!task) throw new DomainError('task_not_found', `No task ${target.taskId}.`);
  assertNotWatchHome(task);
  if (isTaskClosed(task)) {
    throw new DomainError(
      'task_settled',
      `“${task.title}” is closed, so a message would never be read. Start a new task on each run instead.`
    );
  }
  return target;
}

function resolveUserSource(
  decider: Decider,
  command: CommandOf<'schedule.write'>,
  existing: Schedule | null
) {
  if (!command.source) return existing?.source ?? null;
  const source = { projectId: command.source.projectId, server: command.source.server.trim() };
  findProjectSource(decider, source);
  return source;
}

function selectWrittenTarget(
  decider: Decider,
  command: CommandOf<'schedule.write'>,
  existing: Schedule | null,
  source: ScheduleSource | null
) {
  assertSourceChange(source, existing, command.target !== null);
  if (source) return resolveSourceTarget(decider, command, existing, source);
  if (command.target) return resolveUserTarget(decider, command.target);
  if (existing) return existing.target;
  throw new DomainError(
    'schedule_invalid',
    'Say what it does: start a new task in a repository, or message a task.'
  );
}

export function writeUserSchedule(decider: Decider, command: CommandOf<'schedule.write'>) {
  assertTimeZone(command.timeZone);
  const existing = command.scheduleId ? (decider.state.schedules[command.scheduleId] ?? null) : null;
  if (command.scheduleId && !existing) {
    throw new DomainError('schedule_not_found', `No schedule ${command.scheduleId}.`);
  }
  const source = resolveUserSource(decider, command, existing);
  if (!existing && source && decider.context.onBehalf) {
    assertSourceChange(source, null, command.target !== null);
    const origin = { kind: 'agent' as const, taskId: decider.context.byTask ?? null, runId: null };
    suggestWatch(decider, resolveSuggestion(decider, command, source, origin));
    return;
  }
  if (!existing) assertScheduleRoom(decider, null);
  const body = resolveWrittenBody(
    decider,
    command,
    existing,
    selectWrittenTarget(decider, command, existing, source),
    source
  );
  emitWritten(decider, existing, body, { kind: 'you' });
}

export function acceptWatchSuggestion(decider: Decider, command: CommandOf<'watch_suggestion.accept'>) {
  if (decider.context.onBehalf) {
    throw new DomainError(
      'human_only',
      'Only the human accepts a suggested watch. It waits for them in Settings → Automations.'
    );
  }
  const suggestion = findOpenWatchSuggestion(decider, command.suggestionId);
  const source = { projectId: suggestion.projectId, server: suggestion.server };
  findProjectSource(decider, source);
  assertScheduleRoom(decider, null);
  const write = { ...suggestion, enabled: true };
  const body = resolveWrittenBody(
    decider,
    write,
    null,
    resolveSourceTarget(decider, write, null, source),
    source
  );
  const schedule = emitWritten(decider, null, body, { kind: 'you' });
  decider.emit({ type: 'watch_suggestion.accepted', suggestionId: suggestion.id, scheduleId: schedule.id });
}

export function removeOwnSchedule(decider: Decider, command: CommandOf<'agent.delete_schedule'>) {
  const { task } = findCurrentRun(decider, command.runId, 'delete_schedule');
  const schedule = selectOwnSchedule(decider, command.scheduleId, task);
  decider.emit({ type: 'schedule.removed', scheduleId: schedule.id });
  closeWatchHome(decider, schedule);
}

function describeStopped(schedule: Schedule) {
  if (schedule.stopped === 'target_gone')
    return 'The task it messages is closed, so it cannot run again. Delete it.';
  return 'It has finished its runs. Delete it, or ask an agent to set a new time.';
}

export function enableSchedule(decider: Decider, command: CommandOf<'schedule.enable'>) {
  const schedule = decider.state.schedules[command.scheduleId];
  if (!schedule) throw new DomainError('schedule_not_found', 'This schedule no longer exists.');
  if (schedule.enabled === command.enabled) return;
  const now = decider.context.now;
  if (!command.enabled) {
    decider.emit({ type: 'schedule.written', schedule: { ...schedule, enabled: false, updatedAt: now } });
    return;
  }
  if (schedule.stopped !== null) throw new DomainError('schedule_finished', describeStopped(schedule));
  const nextRunAt = resolveNextRun(schedule.trigger, now, schedule.timeZone);
  if (schedule.trigger.kind !== 'webhook' && nextRunAt === null) {
    throw new DomainError(
      'schedule_past',
      'Its time has passed, so it would never run again. Delete it instead.'
    );
  }
  decider.emit({
    type: 'schedule.written',
    schedule: { ...schedule, enabled: true, nextRunAt, updatedAt: now },
  });
}

export function removeSchedule(decider: Decider, command: CommandOf<'schedule.remove'>) {
  const schedule = decider.state.schedules[command.scheduleId];
  if (!schedule) return;
  decider.emit({ type: 'schedule.removed', scheduleId: schedule.id });
  closeWatchHome(decider, schedule);
}

function selectGoneReason(decider: Decider, schedule: Schedule) {
  if (schedule.source && !selectProjectSource(decider, schedule.source)) {
    return 'Its data source was removed from the project.';
  }
  const target = schedule.target;
  if (target.kind === 'new_task') {
    if (target.repoId !== null && !decider.state.repos[target.repoId]) return 'Its repository was removed.';
    return null;
  }
  const task = decider.state.tasks[target.taskId];
  return task && !isTaskClosed(task) ? null : 'The task it messages is closed.';
}

function isPreviousLive(decider: Decider, schedule: Schedule) {
  if (schedule.target.kind === 'new_task') {
    const previous = schedule.lastTaskId ? decider.state.tasks[schedule.lastTaskId] : undefined;
    return previous !== undefined && !isTaskSettled(previous);
  }
  const previous = schedule.lastRunId ? decider.state.runs[schedule.lastRunId] : undefined;
  return previous !== undefined && previous.endedAt === null;
}

function resolveLatestRun(decider: Decider, taskId: string) {
  let latest: Run | null = null;
  for (const run of listActiveRuns(decider.state, taskId)) {
    if (!latest || run.startedAt >= latest.startedAt) latest = run;
  }
  return latest?.id ?? null;
}

function recordRun(
  decider: Decider,
  schedule: Schedule,
  run: Omit<ScheduleRun, 'at' | 'deliveryId'>,
  delivery: Pick<Delivery, 'deliveryId' | 'replayKey'>,
  patch: Partial<Pick<Schedule, 'runCount' | 'lastTaskId' | 'lastRunId' | 'stopped' | 'nextRunAt'>>
) {
  decider.emit({
    type: 'schedule.fired',
    scheduleId: schedule.id,
    run: { ...run, at: decider.context.now, deliveryId: delivery.deliveryId },
    nextRunAt: patch.nextRunAt === undefined ? schedule.nextRunAt : patch.nextRunAt,
    runCount: patch.runCount ?? schedule.runCount,
    lastTaskId: patch.lastTaskId === undefined ? schedule.lastTaskId : patch.lastTaskId,
    lastRunId: patch.lastRunId === undefined ? schedule.lastRunId : patch.lastRunId,
    stopped: patch.stopped === undefined ? schedule.stopped : patch.stopped,
    replayKey: delivery.replayKey,
  });
}

function isScheduleBusy(decider: Decider, schedule: Schedule) {
  if (!schedule.source || schedule.target.kind !== 'task') return false;
  return isIntakeBusy(decider, decider.task(schedule.target.taskId));
}

function resolveFollowing(schedule: Schedule, now: number) {
  return resolveNextRun(schedule.trigger, now, schedule.timeZone);
}

function send(decider: Decider, schedule: Schedule, text: string) {
  const target = schedule.target;
  if (target.kind === 'new_task') {
    const taskId = createTask(
      decider,
      {
        type: 'task.create',
        request: text,
        repoId: target.repoId,
        priority: target.priority,
        mode: target.mode,
      },
      { scheduleId: schedule.id }
    );
    return { taskId, runId: null };
  }
  if (schedule.source) {
    return {
      taskId: target.taskId,
      runId: startIntake(decider, schedule, decider.task(target.taskId), text),
    };
  }
  messageTask(decider, { type: 'task.message', taskId: target.taskId, text }, schedule.id);
  return { taskId: target.taskId, runId: resolveLatestRun(decider, target.taskId) };
}

function runSchedule(decider: Decider, schedule: Schedule, delivery: Delivery) {
  const now = decider.context.now;
  const gone = selectGoneReason(decider, schedule);
  if (gone) {
    recordRun(decider, schedule, { outcome: 'skipped', taskId: null, detail: gone }, delivery, {
      nextRunAt: null,
      stopped: 'target_gone',
    });
    return;
  }
  if (delivery.skipWhenLive && isPreviousLive(decider, schedule)) {
    recordRun(decider, schedule, { outcome: 'skipped', taskId: null, detail: STILL_LIVE }, delivery, {
      nextRunAt: resolveFollowing(schedule, now),
    });
    return;
  }
  if (isScheduleBusy(decider, schedule)) {
    recordRun(decider, schedule, { outcome: 'skipped', taskId: null, detail: INTAKE_BUSY }, delivery, {
      nextRunAt: resolveFollowing(schedule, now),
    });
    return;
  }
  const sent = send(decider, schedule, delivery.text);
  const runCount = schedule.runCount + 1;
  const exhausted =
    schedule.trigger.kind === 'once' || (schedule.maxRuns !== null && runCount >= schedule.maxRuns);
  recordRun(decider, schedule, { outcome: 'sent', taskId: sent.taskId, detail: null }, delivery, {
    runCount,
    lastTaskId: sent.taskId,
    lastRunId: sent.runId,
    nextRunAt: exhausted ? null : resolveFollowing(schedule, now),
    stopped: exhausted ? 'finished' : null,
  });
}

export function fireSchedule(decider: Decider, command: CommandOf<'schedule.fire'>) {
  const schedule = decider.state.schedules[command.scheduleId];
  if (!schedule?.enabled || schedule.trigger.kind === 'webhook') return;
  if (schedule.nextRunAt !== command.dueAt || command.dueAt > decider.context.now) return;
  runSchedule(decider, schedule, {
    text: schedule.text,
    deliveryId: null,
    replayKey: null,
    skipWhenLive: true,
  });
}

export function deliverSchedule(decider: Decider, command: CommandOf<'schedule.deliver'>) {
  const schedule = decider.state.schedules[command.scheduleId];
  if (!schedule?.enabled || schedule.trigger.kind !== 'webhook') return;
  const key = command.replayKey;
  if (key !== null && (schedule.replayKeys[key] ?? 0) > decider.context.now) return;
  const text = command.text.trim();
  if (!text) throw new DomainError('schedule_invalid', 'The filled-in prompt is empty.');
  runSchedule(decider, schedule, {
    text,
    deliveryId: command.deliveryId,
    replayKey: key,
    skipWhenLive: false,
  });
}

export function failSchedule(decider: Decider, command: CommandOf<'schedule.fail'>) {
  const schedule = decider.state.schedules[command.scheduleId];
  if (!schedule) return;
  const timed = command.dueAt !== null;
  if (timed && (!schedule.enabled || schedule.nextRunAt !== command.dueAt)) return;
  if (!timed && schedule.trigger.kind !== 'webhook') return;
  const nextRunAt = timed ? resolveFollowing(schedule, decider.context.now) : schedule.nextRunAt;
  const finished = timed && nextRunAt === null;
  recordRun(
    decider,
    schedule,
    { outcome: 'failed', taskId: null, detail: command.detail.slice(0, SCHEDULE_LIMITS.detail) },
    { deliveryId: command.deliveryId, replayKey: null },
    { nextRunAt, ...(finished ? { stopped: 'finished' as const } : {}) }
  );
}
