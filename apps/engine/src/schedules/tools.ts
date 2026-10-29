import {
  DomainError,
  describeScheduleTarget,
  describeScheduleTrigger,
  listSchedules,
  type Schedule,
  type ScheduleRequest,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
  validateReportFiling,
  validateScheduleRequest,
} from '@shinsa/core';
import { assertProtocol, readString } from '../agents/handover.ts';
import { describeError } from '../log/index.ts';
import type { SecretStore } from '../secrets/index.ts';
import { WEBHOOK_ROUTE_PREFIX } from './webhook.ts';

export interface ScheduleToolCall {
  runId: string;
  attemptId: string;
  state: () => ShinsaState;
  dispatch: (command: ShinsaCommand) => Promise<ShinsaEvent[]>;
}

export interface ScheduleToolContext {
  secrets: SecretStore;
  baseUrl: () => string;
  timeZone: string;
  now: () => number;
}

const RECENT_RUNS = 5;

const NO_SECRET =
  'A signature check needs the signing secret. Ask for it with request_secret and pass the secret-ref it returns as webhook.signature.secret_ref.';

function serializeTime(at: number | null) {
  return at === null ? null : new Date(at).toISOString();
}

function findTaskOf(state: ShinsaState, runId: string) {
  const taskId = state.runs[runId]?.taskId;
  const task = taskId ? state.tasks[taskId] : undefined;
  if (!task) throw new Error('This run no longer exists. End your turn.');
  return task;
}

export function findHookUrl(context: ScheduleToolContext, scheduleId: string) {
  const hook = context.secrets.selectHook(scheduleId);
  if (!hook) throw new DomainError('schedule_not_found', 'This schedule has no webhook.');
  return `${context.baseUrl()}${WEBHOOK_ROUTE_PREFIX}/${encodeURIComponent(scheduleId)}/${hook.token}`;
}

function describeTarget(state: ShinsaState, schedule: Schedule, ownTaskId: string) {
  if (schedule.target.kind === 'task' && schedule.target.taskId === ownTaskId)
    return 'It messages this task.';
  return `${describeScheduleTarget(schedule, (taskId) => state.tasks[taskId]?.title ?? null)}.`;
}

function describeWebhook(context: ScheduleToolContext, schedule: Schedule) {
  if (schedule.trigger.kind !== 'webhook') return [];
  const lines = [
    `Its URL is ${findHookUrl(context, schedule.id)}. Give it to the sender as it is: the token in it is what lets a request in, so do not post it anywhere public.`,
  ];
  const signature = schedule.trigger.signature;
  if (signature) lines.push(`Requests must carry a valid ${signature.header} signature.`);
  return lines;
}

function describeSaved(
  context: ScheduleToolContext,
  state: ShinsaState,
  schedule: Schedule,
  ownTaskId: string
) {
  const when = describeScheduleTrigger(schedule.trigger);
  const zone = schedule.trigger.kind === 'daily' ? ` in ${schedule.timeZone}` : '';
  const next = schedule.nextRunAt === null ? '' : ` Next run ${serializeTime(schedule.nextRunAt)}.`;
  const paused = schedule.enabled ? '' : ' It is paused.';
  return [
    `Saved “${schedule.name}” (schedule_id ${schedule.id}). ${when}${zone}.${next}${paused} ${describeTarget(state, schedule, ownTaskId)}`,
    ...describeWebhook(context, schedule),
  ].join('\n');
}

function assertSigningSecret(context: ScheduleToolContext, state: ShinsaState, request: ScheduleRequest) {
  const trigger = request.trigger;
  if (trigger?.kind !== 'webhook' || !trigger.signature || request.secretRef) return;
  const existing = request.scheduleId ? state.schedules[request.scheduleId] : undefined;
  if (existing && context.secrets.selectHook(existing.id)?.secret) return;
  throw new Error(NO_SECRET);
}

function writeSigningSecret(
  context: ScheduleToolContext,
  schedule: Schedule,
  ref: string | null,
  taskId: string
) {
  if (schedule.trigger.kind !== 'webhook' || !ref) return null;
  if (context.secrets.selectHook(schedule.id)?.secret && !context.secrets.hasRef(ref)) return null;
  try {
    context.secrets.writeHookSecret(schedule.id, context.secrets.removeRef(ref, taskId));
    return null;
  } catch (error) {
    return `The schedule was saved, but its signing secret was not: ${describeError(error)} Then call set_schedule with schedule_id ${schedule.id} and the new ref.`;
  }
}

async function writeSchedule(
  input: Record<string, unknown>,
  call: ScheduleToolCall,
  context: ScheduleToolContext
) {
  const request = assertProtocol(validateScheduleRequest(input, context.now()));
  const task = findTaskOf(call.state(), call.runId);
  assertSigningSecret(context, call.state(), request);
  const existing = request.scheduleId ? call.state().schedules[request.scheduleId] : undefined;
  const events = await call.dispatch({
    type: 'agent.set_schedule',
    runId: call.runId,
    attemptId: call.attemptId,
    scheduleId: request.scheduleId,
    name: request.name,
    text: request.text,
    trigger: request.trigger,
    target: request.target,
    source: request.source,
    enabled: request.enabled,
    maxRuns: request.maxRuns,
    timeZone: request.timeZone ?? existing?.timeZone ?? context.timeZone,
  });
  const written = events.find((event) => event.type === 'schedule.written');
  const schedule = written?.schedule ?? existing;
  if (!schedule) throw new Error('Nothing was saved. Call set_schedule again with a time and a message.');
  const problem = writeSigningSecret(context, schedule, request.secretRef, task.id);
  const saved = describeSaved(context, call.state(), schedule, task.id);
  return problem ? `${saved}\n${problem}` : saved;
}

function serializeSchedule(
  context: ScheduleToolContext,
  state: ShinsaState,
  schedule: Schedule,
  ownTaskId: string
) {
  const own = schedule.createdBy.kind === 'agent' && schedule.createdBy.taskId === ownTaskId;
  return {
    schedule_id: schedule.id,
    name: schedule.name,
    message: schedule.text,
    when: describeScheduleTrigger(schedule.trigger),
    time_zone: schedule.timeZone,
    target: describeTarget(state, schedule, ownTaskId),
    enabled: schedule.enabled,
    finished: schedule.stopped !== null,
    next_run_at: serializeTime(schedule.nextRunAt),
    runs: schedule.runCount,
    max_runs: schedule.maxRuns,
    yours: own,
    ...(own && schedule.trigger.kind === 'webhook' ? { url: findHookUrl(context, schedule.id) } : {}),
    last_runs: schedule.runs.slice(-RECENT_RUNS).map((run) => ({
      at: serializeTime(run.at),
      outcome: run.outcome,
      ...(run.taskId ? { task_id: run.taskId } : {}),
      ...(run.detail ? { detail: run.detail } : {}),
    })),
  };
}

function serializeSchedules(call: ScheduleToolCall, context: ScheduleToolContext) {
  const state = call.state();
  const task = findTaskOf(state, call.runId);
  const schedules = listSchedules(state).map((schedule) =>
    serializeSchedule(context, state, schedule, task.id)
  );
  return JSON.stringify({ now: serializeTime(context.now()), schedules }, null, 2);
}

async function removeSchedule(input: Record<string, unknown>, call: ScheduleToolCall) {
  const scheduleId = readString(input, 'schedule_id');
  if (!scheduleId) throw new Error('schedule_id is required.');
  const name = call.state().schedules[scheduleId]?.name;
  await call.dispatch({
    type: 'agent.delete_schedule',
    runId: call.runId,
    attemptId: call.attemptId,
    scheduleId,
  });
  return `Deleted “${name ?? scheduleId}”.`;
}

function resolveFiledFork(state: ShinsaState, reference: string | null) {
  if (reference === null) return null;
  const handle = reference.toUpperCase();
  const task =
    state.tasks[reference] ?? Object.values(state.tasks).find((candidate) => candidate.handle === handle);
  if (!task) {
    throw new Error(`There is no task "${reference}" to fork. Find it with find_tasks and pass its id.`);
  }
  return task.id;
}

function resolveFiledRepo(state: ShinsaState, name: string | null) {
  if (name === null) return null;
  const repo = Object.values(state.repos).find((candidate) => candidate.name === name);
  if (repo) return repo.id;
  const known = Object.values(state.repos).map((candidate) => candidate.name);
  throw new Error(`There is no repository "${name}". Known: ${known.join(', ') || 'none'}.`);
}

async function fileReport(input: Record<string, unknown>, call: ScheduleToolCall) {
  const { forkFrom, repository, ...filing } = assertProtocol(validateReportFiling(input));
  const state = call.state();
  const events = await call.dispatch({
    type: 'agent.file_report',
    runId: call.runId,
    attemptId: call.attemptId,
    ...filing,
    forkOf: resolveFiledFork(state, forkFrom),
    repoId: resolveFiledRepo(state, repository),
  });
  const created = events.find((event) => event.type === 'task.created');
  const task = created?.type === 'task.created' ? call.state().tasks[created.taskId] : undefined;
  if (!task) throw new Error('Nothing was filed. Call file_report again.');
  return `Filed ${task.handle ?? task.id} “${task.title}”. Go on with the next report.`;
}

export function handleScheduleTool(
  name: string,
  input: Record<string, unknown>,
  call: ScheduleToolCall,
  context: ScheduleToolContext
): Promise<string> | null {
  switch (name) {
    case 'set_schedule':
      return writeSchedule(input, call, context);
    case 'list_schedules':
      return Promise.resolve(serializeSchedules(call, context));
    case 'delete_schedule':
      return removeSchedule(input, call);
    case 'file_report':
      return fileReport(input, call);
    default:
      return null;
  }
}
