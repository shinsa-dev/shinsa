import { join } from 'node:path';
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Clock, Console, Effect, FileSystem } from 'effect';
import { CommandLog } from '../../apps/engine/src/store/commands/service.ts';
import { Events } from '../../apps/engine/src/store/events/service.ts';
import { StoreLayer } from '../../apps/engine/src/store/layers.ts';
import type { ChatEvent, Run, ShinsaEvent, ShinsaEventInput } from '../../packages/core/src/index.ts';
import { CHAT_PROTOCOL_VERSION } from '../../packages/core/src/index.ts';
import { reportFailure } from '../kit/script.ts';
import { MINUTE } from '../kit/time.ts';
import { buildLongRun, LONG_CHAT_TASK, listScaledTasks, type ScaledTask } from './content-scale.ts';
import { SCALE_EMPTY, SCALE_USAGE, ScaleDataMissing } from './content/schema.ts';

const TASKS = Number(Bun.env.SHINSA_PERF_TASKS ?? 300);
const RUNS = Number(Bun.env.SHINSA_PERF_RUNS ?? 60);

function listTemplates(events: ShinsaEvent[]) {
  const created = new Map<string, EventOf<'task.created'>>();
  const triaged = new Map<string, EventOf<'task.triaged'>>();
  const staged = new Map<string, EventOf<'task.staged'>>();
  for (const event of events) {
    if (event.type === 'task.created') created.set(event.taskId, event);
    if (event.type === 'task.triaged') triaged.set(event.taskId, event);
    if (event.type === 'task.staged') staged.set(event.taskId, event);
  }
  return [...created.values()].flatMap((create) => {
    const triage = triaged.get(create.taskId);
    const stage = staged.get(create.taskId);
    return triage && stage ? [{ create, triage, stage }] : [];
  });
}

type EventOf<T extends ShinsaEvent['type']> = Extract<ShinsaEvent, { type: T }>;

function strip<T extends { seq: number; at: number }>(event: T) {
  const { seq: _seq, at: _at, ...rest } = event;
  return rest;
}

function cloneTask(task: ScaledTask, template: ReturnType<typeof listTemplates>[number]): ShinsaEventInput[] {
  const { handle: _created, ...create } = strip(template.create) as EventOf<'task.created'> & {
    handle?: string;
  };
  const { handle: _triaged, ...triage } = strip(template.triage) as EventOf<'task.triaged'> & {
    handle?: string;
  };
  return [
    { ...create, taskId: task.id, request: task.request } as ShinsaEventInput,
    { ...triage, taskId: task.id, title: task.title, branch: `perf/${task.id}` } as ShinsaEventInput,
    { ...strip(template.stage), taskId: task.id } as ShinsaEventInput,
  ];
}

function serializeTranscript(runId: string, events: ChatEvent[], from: number, to: number) {
  const step = (to - from) / Math.max(1, events.length);
  const lines = events.map((event, index) =>
    JSON.stringify({
      ...event,
      v: CHAT_PROTOCOL_VERSION,
      id: `${runId}-${index}`,
      at: Math.round(from + step * index),
    })
  );
  return `${lines.join('\n')}\n`;
}

const seedScale = Effect.fn('ContentSeed.scale')(function* (data: string) {
  const fs = yield* FileSystem.FileSystem;
  const now = yield* Clock.currentTimeMillis;
  const transcripts = join(data, 'transcripts');
  yield* Effect.gen(function* () {
    const log = yield* CommandLog;
    const read = yield* (yield* Events).read(0);
    const templates = listTemplates(read.events);
    const template = templates[0];
    if (!template) return yield* new ScaleDataMissing({ message: SCALE_EMPTY });
    yield* fs.makeDirectory(transcripts, { recursive: true });
    let seq = read.lastSeq;
    const commit = Effect.fnUntraced(function* (at: number, events: ShinsaEventInput[]) {
      yield* log.commit({ events, effects: [], cancellations: [], fromSeq: seq, at, receipt: null });
      seq += events.length;
    });
    const extra = Math.max(0, TASKS - templates.length);
    for (const [index, task] of listScaledTasks(extra).entries()) {
      const source = templates[index % templates.length] ?? template;
      yield* commit(now - (index + 1) * 7 * MINUTE, cloneTask(task, source));
    }
    const start = now - RUNS * 6 * MINUTE;
    const created = cloneTask(LONG_CHAT_TASK, template).map((event) =>
      event.type === 'task.staged' ? { ...event, stage: 'building' as const, reason: 'building' } : event
    );
    yield* commit(start - MINUTE, created);
    for (let index = 0; index < RUNS; index += 1) {
      const live = index === RUNS - 1;
      const startedAt = start + index * 6 * MINUTE;
      const endedAt = live ? null : startedAt + 5 * MINUTE;
      const run: Run = {
        id: `${LONG_CHAT_TASK.id}-run-${index}`,
        taskId: LONG_CHAT_TASK.id,
        role: 'agent',
        purpose: index === 0 ? 'build' : 'fix',
        provider: 'claude',
        model: 'claude-opus-4-1',
        sessionId: `${LONG_CHAT_TASK.id}-session`,
        startedAt,
        endedAt: null,
        outcome: null,
        summary: null,
      };
      if (index > 0) {
        yield* commit(startedAt - 30_000, [
          {
            type: 'task.messaged',
            taskId: LONG_CHAT_TASK.id,
            text: `Follow-up ${index}: also cover the case where the list is empty and the header wraps.`,
          },
        ]);
      }
      yield* commit(startedAt, [{ type: 'run.started', run }]);
      yield* fs.writeFileString(
        join(transcripts, `${run.id}.jsonl`),
        serializeTranscript(run.id, buildLongRun(index, live), startedAt, endedAt ?? now - MINUTE)
      );
      if (endedAt !== null) {
        yield* commit(endedAt, [
          { type: 'run.ended', runId: run.id, outcome: 'completed', summary: `Finished step ${index}.` },
        ]);
      }
    }
  }).pipe(Effect.provide(StoreLayer(join(data, 'shinsa.sqlite'))));
  yield* Console.info(`Scaled ${data}: ${TASKS} tasks, ${LONG_CHAT_TASK.id} with ${RUNS} runs.`);
});

Effect.gen(function* () {
  const data = Bun.argv[2];
  if (!data) return yield* new ScaleDataMissing({ message: SCALE_USAGE });
  yield* seedScale(data);
}).pipe(
  reportFailure,
  Effect.provide(BunServices.layer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
