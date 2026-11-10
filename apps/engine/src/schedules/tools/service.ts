import {
  describeScheduleTarget,
  describeScheduleTrigger,
  listOpenWatchSuggestions,
  listProjectRepos,
  listSchedules,
  type Schedule,
  type ScheduleRequest,
  type ShinsaEvent,
  type ShinsaState,
  type Task,
  validateReportFiling,
  validateScheduleRequest,
} from '@shinsa/core';
import { Clock, Context, DateTime, Effect, Layer, type Result } from 'effect';
import { readString, resolveHandOver } from '../../agents/handover.ts';
import { resolveForkSource } from '../../agents/tools/forks.ts';
import { describeError } from '../../log/redact.ts';
import { SecretStore } from '../../secrets/index.ts';
import { RECENT_RUNS, ScheduleTimeZone, WEBHOOK_ROUTE_PREFIX } from '../schema.ts';
import {
  ScheduleSecretFailed,
  type ScheduleToolRun,
  type ScheduleToolsShape,
  ScheduleToolRefused,
  type ScheduleUrls,
} from './schema.ts';

export class ScheduleTools extends Context.Service<ScheduleTools, ScheduleToolsShape>()(
  'shinsa/engine/schedules/tools/ScheduleTools'
) {
  static readonly layer = (urls: ScheduleUrls) =>
    Layer.effect(
      ScheduleTools,
      Effect.gen(function* () {
        const secrets = yield* SecretStore;
        const timeZone = yield* ScheduleTimeZone;
        const refuse = (message: string) => new ScheduleToolRefused({ message });

        const attempt = <A, E>(result: Result.Result<A, E>) =>
          Effect.fromResult(result).pipe(Effect.mapError((error) => refuse(describeError(error))));

        const serializeTime = (at: number | null) =>
          at === null ? null : DateTime.formatIso(DateTime.makeUnsafe(at));

        const findTaskOf = Effect.fn('ScheduleTools.findTaskOf')(function* (
          state: ShinsaState,
          runId: string
        ) {
          const taskId = state.runs[runId]?.taskId;
          const task = taskId ? state.tasks[taskId] : undefined;
          if (!task) return yield* refuse('This run no longer exists. End your turn.');
          return task;
        });

        const resolveHookUrl = Effect.fn('ScheduleTools.resolveHookUrl')(function* (
          scheduleId: string,
          token: string
        ) {
          const remote = yield* urls.hookUrl(scheduleId, token);
          if (remote) return remote;
          return `${yield* urls.baseUrl}${WEBHOOK_ROUTE_PREFIX}/${encodeURIComponent(scheduleId)}/${token}`;
        });

        const upsertHookUrl = Effect.fn('ScheduleTools.upsertHookUrl')(function* (scheduleId: string) {
          return yield* resolveHookUrl(scheduleId, (yield* secrets.upsertHook(scheduleId)).token);
        });

        const describeTarget = (state: ShinsaState, schedule: Schedule, ownTaskId: string) => {
          if (schedule.target.kind === 'task' && schedule.target.taskId === ownTaskId)
            return 'It messages this task.';
          return `${describeScheduleTarget(schedule, (taskId) => state.tasks[taskId]?.title ?? null)}.`;
        };

        const describeWebhook = Effect.fn('ScheduleTools.describeWebhook')(function* (schedule: Schedule) {
          if (schedule.trigger.kind !== 'webhook') return [];
          const lines = [
            `Its URL is ${yield* upsertHookUrl(schedule.id)}. Give it to the sender as it is: the token in it is what lets a request in, so do not post it anywhere public.`,
          ];
          const signature = schedule.trigger.signature;
          if (signature) lines.push(`Requests must carry a valid ${signature.header} signature.`);
          return lines;
        });

        const describeSaved = Effect.fn('ScheduleTools.describeSaved')(function* (
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
            ...(yield* describeWebhook(schedule)),
          ].join('\n');
        });

        const assertSigningSecret = Effect.fn('ScheduleTools.assertSigningSecret')(function* (
          scheduleId: string | null,
          ref: string | null,
          field: string
        ) {
          if (ref) return;
          if (scheduleId && (yield* secrets.selectHook(scheduleId))?.secret) return;
          return yield* refuse(
            `A signature check needs the signing secret. Ask for it with request_secret and pass the secret-ref it returns as ${field}.`
          );
        });

        const writeSigningSecret = Effect.fn('ScheduleTools.writeSigningSecret')(function* (
          schedule: Schedule,
          ref: string | null,
          taskId: string
        ) {
          if (schedule.trigger.kind !== 'webhook' || !ref) return null;
          if ((yield* secrets.selectHook(schedule.id))?.secret && !(yield* secrets.hasRef(ref))) return null;
          return yield* secrets.removeRef(ref, taskId).pipe(
            Effect.mapError((error) => new ScheduleSecretFailed({ message: describeError(error) })),
            Effect.flatMap((secret) => secrets.writeHookSecret(schedule.id, secret)),
            Effect.as(null),
            Effect.catch((failure) =>
              Effect.succeed(
                `The schedule was saved, but its signing secret was not: ${failure.message} Then call set_schedule with schedule_id ${schedule.id} and the new ref as webhook.signature.secret_ref.`
              )
            )
          );
        });

        const writeScheduleSecret = Effect.fn('ScheduleTools.writeScheduleSecret')(function* (
          state: ShinsaState,
          scheduleId: string,
          ref: string | null,
          taskId: string
        ) {
          const schedule = state.schedules[scheduleId];
          return schedule ? yield* writeSigningSecret(schedule, ref, taskId) : null;
        });

        const describeSuggested = (state: ShinsaState, events: ShinsaEvent[], taskId: string) => {
          const recorded = events.find((event) => event.type === 'watch_suggestion.recorded')?.suggestion;
          const suggestion =
            recorded ??
            listOpenWatchSuggestions(state)
              .filter((candidate) => candidate.origin.kind === 'agent' && candidate.origin.taskId === taskId)
              .at(-1);
          const name = suggestion ? `“${suggestion.name}” ` : '';
          return `Suggested the watch ${name}for the human to accept. It starts reading only once they accept it, with one click on the card in this chat or in Settings → Automations. Tell them so in your hand-over; do not set it again.`;
        };

        const resolveNamedRepo = Effect.fn('ScheduleTools.resolveNamedRepo')(function* (
          state: ShinsaState,
          task: Task,
          reference: string
        ) {
          const projectRepos = task.projectId ? listProjectRepos(state, task.projectId) : [];
          const candidates = projectRepos.length > 0 ? projectRepos : Object.values(state.repos);
          const repo =
            candidates.find((candidate) => candidate.id === reference) ??
            candidates.find((candidate) => candidate.name === reference);
          if (repo) return repo.id;
          const known = candidates.map((candidate) => candidate.name);
          return yield* refuse(
            `There is no repository "${reference}". Name one of: ${known.join(', ') || 'none'}.`
          );
        });

        const resolveTarget = Effect.fn('ScheduleTools.resolveTarget')(function* (
          state: ShinsaState,
          task: Task,
          request: ScheduleRequest
        ) {
          const { target, repository } = request;
          if (target?.kind !== 'new_task' || repository === null) return target;
          return { ...target, repoId: yield* resolveNamedRepo(state, task, repository) };
        });

        const writeSchedule = Effect.fn('ScheduleTools.writeSchedule')(function* (
          input: Record<string, unknown>,
          run: ScheduleToolRun
        ) {
          const now = yield* Clock.currentTimeMillis;
          const request = yield* attempt(resolveHandOver(validateScheduleRequest(input, now)));
          const before = yield* run.state;
          const task = yield* findTaskOf(before, run.runId);
          if (request.trigger?.kind === 'webhook' && request.trigger.signature) {
            yield* assertSigningSecret(request.scheduleId, request.secretRef, 'webhook.signature.secret_ref');
          }
          const existing = request.scheduleId ? before.schedules[request.scheduleId] : undefined;
          const events = yield* run.dispatch({
            type: 'agent.set_schedule',
            runId: run.runId,
            attemptId: run.attemptId,
            scheduleId: request.scheduleId,
            name: request.name,
            text: request.text,
            trigger: request.trigger,
            target: yield* resolveTarget(before, task, request),
            source: request.source,
            enabled: request.enabled,
            maxRuns: request.maxRuns,
            timeZone: request.timeZone ?? existing?.timeZone ?? timeZone,
          });
          if (request.source && !existing) return describeSuggested(yield* run.state, events, task.id);
          const written = events.find((event) => event.type === 'schedule.written');
          const schedule = written?.schedule ?? existing;
          if (!schedule)
            return yield* refuse('Nothing was saved. Call set_schedule again with a time and a message.');
          const problem = yield* writeSigningSecret(schedule, request.secretRef, task.id);
          const saved = yield* describeSaved(yield* run.state, schedule, task.id);
          return problem ? `${saved}\n${problem}` : saved;
        });

        const serializeSchedule = Effect.fn('ScheduleTools.serializeSchedule')(function* (
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
            ...(own && schedule.trigger.kind === 'webhook' ? { url: yield* upsertHookUrl(schedule.id) } : {}),
            last_runs: schedule.runs.slice(-RECENT_RUNS).map((entry) => ({
              at: serializeTime(entry.at),
              outcome: entry.outcome,
              ...(entry.taskId ? { task_id: entry.taskId } : {}),
              ...(entry.detail ? { detail: entry.detail } : {}),
            })),
          };
        });

        const serializeSchedules = Effect.fn('ScheduleTools.serializeSchedules')(function* (
          run: ScheduleToolRun
        ) {
          const state = yield* run.state;
          const task = yield* findTaskOf(state, run.runId);
          const schedules = yield* Effect.forEach(listSchedules(state), (schedule) =>
            serializeSchedule(state, schedule, task.id)
          );
          return JSON.stringify({ now: serializeTime(yield* Clock.currentTimeMillis), schedules }, null, 2);
        });

        const removeSchedule = Effect.fn('ScheduleTools.removeSchedule')(function* (
          input: Record<string, unknown>,
          run: ScheduleToolRun
        ) {
          const scheduleId = readString(input, 'schedule_id');
          if (!scheduleId) return yield* refuse('schedule_id is required.');
          const name = (yield* run.state).schedules[scheduleId]?.name;
          yield* run.dispatch({
            type: 'agent.delete_schedule',
            runId: run.runId,
            attemptId: run.attemptId,
            scheduleId,
          });
          return `Deleted “${name ?? scheduleId}”.`;
        });

        const fileReport = Effect.fn('ScheduleTools.fileReport')(function* (
          input: Record<string, unknown>,
          run: ScheduleToolRun
        ) {
          const { forkFrom, repository, ...filing } = yield* attempt(
            resolveHandOver(validateReportFiling(input))
          );
          const state = yield* run.state;
          const forkOf = forkFrom === null ? null : yield* attempt(resolveForkSource(state, forkFrom));
          const repoId =
            repository === null
              ? null
              : yield* resolveNamedRepo(state, yield* findTaskOf(state, run.runId), repository);
          const events = yield* run.dispatch({
            type: 'agent.file_report',
            runId: run.runId,
            attemptId: run.attemptId,
            ...filing,
            forkOf,
            repoId,
          });
          const after = yield* run.state;
          const linked = events.find((event) => event.type === 'watchdog.report_linked');
          if (linked?.type === 'watchdog.report_linked') {
            const known = after.tasks[linked.reportTaskId];
            return `This report was already filed as ${known?.handle ?? linked.reportTaskId} “${known?.title ?? ''}”, so the watchdog counts it. Go on with the next report.`;
          }
          const created = events.find((event) => event.type === 'task.created');
          const task = created?.type === 'task.created' ? after.tasks[created.taskId] : undefined;
          if (!task) return yield* refuse('Nothing was filed. Call file_report again.');
          return `Filed ${task.handle ?? task.id} “${task.title}”. Go on with the next report.`;
        });

        const handle = (name: string, input: Record<string, unknown>, run: ScheduleToolRun) => {
          switch (name) {
            case 'set_schedule':
              return writeSchedule(input, run);
            case 'list_schedules':
              return serializeSchedules(run);
            case 'delete_schedule':
              return removeSchedule(input, run);
            case 'file_report':
              return fileReport(input, run);
            default:
              return null;
          }
        };

        return ScheduleTools.of({ upsertHookUrl, assertSigningSecret, writeScheduleSecret, handle });
      })
    );
}
