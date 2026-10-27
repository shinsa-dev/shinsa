import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '../../apps/engine/src/store/index.ts';
import type { ChatEvent, Run, ShinsaEvent, ShinsaEventInput } from '../../packages/core/src/index.ts';
import { CHAT_PROTOCOL_VERSION } from '../../packages/core/src/index.ts';
import { buildLongRun, LONG_CHAT_TASK, listScaledTasks, type ScaledTask } from './content-scale.ts';

const DATA = Bun.argv[2];
const TASKS = Number(Bun.env.SHINSA_PERF_TASKS ?? 300);
const RUNS = Number(Bun.env.SHINSA_PERF_RUNS ?? 60);

if (!DATA) {
  console.error('Usage: bun scripts/perf/seed-scale.ts <data dir>   (a copy of `bun run seed`)');
  process.exit(1);
}

const MINUTE = 60_000;
const NOW = Date.now();

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

function writeTranscript(dir: string, runId: string, events: ChatEvent[], from: number, to: number) {
  const step = (to - from) / Math.max(1, events.length);
  const lines = events.map((event, index) =>
    JSON.stringify({
      ...event,
      v: CHAT_PROTOCOL_VERSION,
      id: `${runId}-${index}`,
      at: Math.round(from + step * index),
    })
  );
  writeFileSync(join(dir, `${runId}.jsonl`), `${lines.join('\n')}\n`);
}

function seedScale() {
  const log = new EventLog(join(DATA as string, 'shinsa.sqlite'));
  const read = log.readEvents();
  const templates = listTemplates(read.events);
  const template = templates[0];
  if (!template) throw new Error('The data dir has no tasks to copy: run `bun run seed` into it first.');
  let seq = read.lastSeq;
  const commit = (at: number, events: ShinsaEventInput[]) => {
    log.commitCommand({ events, effects: [], cancellations: [], fromSeq: seq, at, receipt: null });
    seq += events.length;
  };
  const extra = Math.max(0, TASKS - templates.length);
  listScaledTasks(extra).forEach((task, index) => {
    const source = templates[index % templates.length] ?? template;
    commit(NOW - (index + 1) * 7 * MINUTE, cloneTask(task, source));
  });

  const transcripts = join(DATA as string, 'transcripts');
  mkdirSync(transcripts, { recursive: true });
  const start = NOW - RUNS * 6 * MINUTE;
  const created = cloneTask(LONG_CHAT_TASK, template).map((event) =>
    event.type === 'task.staged' ? { ...event, stage: 'building' as const, reason: 'building' } : event
  );
  commit(start - MINUTE, created);
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
      commit(startedAt - 30_000, [
        {
          type: 'task.messaged',
          taskId: LONG_CHAT_TASK.id,
          text: `Follow-up ${index}: also cover the case where the list is empty and the header wraps.`,
        },
      ]);
    }
    commit(startedAt, [{ type: 'run.started', run }]);
    writeTranscript(transcripts, run.id, buildLongRun(index, live), startedAt, endedAt ?? NOW - MINUTE);
    if (endedAt !== null) {
      commit(endedAt, [
        { type: 'run.ended', runId: run.id, outcome: 'completed', summary: `Finished step ${index}.` },
      ]);
    }
  }
  log.close();
  console.info(`Scaled ${DATA}: ${TASKS} tasks, ${LONG_CHAT_TASK.id} with ${RUNS} runs.`);
}

seedScale();
