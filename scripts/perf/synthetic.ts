import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '../../apps/engine/src/store/index.ts';
import {
  applyEvent,
  CHAT_PROTOCOL_VERSION,
  type ChatEntry,
  createState,
  decide,
  listActiveRuns,
  listOpenGates,
  type PlanDocument,
  type ReportCheck,
  type ShinsaCommand,
  type ShinsaState,
} from '../../packages/core/src/index.ts';

export interface SyntheticOptions {
  tasks: number;
  targetEvents: number;
  longTranscripts: number;
  longTranscriptEntries: number;
  shortTranscriptEntries: number;
}

export const LARGE: SyntheticOptions = {
  tasks: 200,
  targetEvents: 50_000,
  longTranscripts: 20,
  longTranscriptEntries: 5_000,
  shortTranscriptEntries: 60,
};

const PASSING: ReportCheck[] = [
  { name: 'bun lint', outcome: 'pass', detail: null },
  { name: 'bun check-types', outcome: 'pass', detail: null },
];

const PLAN: PlanDocument = {
  goal: 'Make exports retry on timeouts so a slow disk never loses a chunk.',
  phases: [
    { title: 'Wrap the write', detail: 'Retry each chunk write three times with a backoff.' },
    { title: 'Cover it with tests', detail: 'One test per error kind, including a torn write.' },
    { title: 'Measure it', detail: 'Run the export benchmark before and after.' },
  ],
  behaviour: ['A slow write is retried.', 'A failing write reports which chunk failed.'],
  approach: 'A small retry helper beside the writer, used by every chunk write.',
  files: [],
  outOfScope: [],
  verification: ['bun test covers every error kind.'],
  questions: [],
};

const REPOS = ['paywall-next', 'shinsa', 'superwall-ios', 'dashboard', 'billing'];

function createRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

class Writer {
  state: ShinsaState = createState();
  clock = Date.UTC(2026, 8, 1);
  counter = 0;
  readonly log: EventLog;

  constructor(log: EventLog) {
    this.log = log;
  }

  send(command: ShinsaCommand) {
    this.clock += 7_000;
    const decision = decide(this.state, command, {
      now: this.clock,
      newId: () => `0199${(++this.counter).toString(16).padStart(8, '0')}-0000-7000-8000-000000000000`,
    });
    const committed = this.log.commitCommand({
      events: decision.events,
      effects: [],
      cancellations: [],
      fromSeq: this.state.seq,
      at: this.clock,
      receipt: null,
    });
    for (const event of committed.events) this.state = applyEvent(this.state, event);
    return decision;
  }

  activeRun(taskId: string) {
    return listActiveRuns(this.state, taskId)[0] ?? null;
  }

  openGate(taskId: string) {
    return listOpenGates(this.state, taskId)[0] ?? null;
  }
}

function meter(writer: Writer, taskId: string, times: number) {
  const run = writer.activeRun(taskId);
  if (!run) return;
  for (let index = 0; index < times; index += 1) {
    writer.send({
      type: 'run.meter',
      runId: run.id,
      usage: {
        inputTokens: 1200 + index,
        outputTokens: 300,
        cacheReadTokens: 40_000,
        cacheWriteTokens: 900,
        costUsd: 0.04,
      },
    });
  }
}

function brief(writer: Writer, taskIds: string[]) {
  writer.log.writeBriefing(null, {
    text: `Start with the export retry; ${taskIds.length} tasks are open and three wait on your review. The billing migration is paused on its usage limit and resumes at noon.`,
    at: writer.clock,
    briefing: null,
  });
}

function reprioritize(writer: Writer, taskIds: string[], index: number) {
  const taskId = taskIds[index % taskIds.length] ?? '';
  const current = writer.state.tasks[taskId]?.priority;
  writer.send({ type: 'task.prioritize', taskId, priority: current === 'high' ? 'normal' : 'high' });
}

function link(writer: Writer, taskId: string) {
  const run = writer.activeRun(taskId);
  if (!run || run.sessionId) return;
  writer.send({ type: 'run.link', runId: run.id, sessionId: `session-${run.id}`, provider: 'claude' });
}

function walkTask(writer: Writer, taskId: string, random: () => number, meterTimes: number) {
  const step = (action: () => void) => {
    try {
      action();
      return true;
    } catch {
      return false;
    }
  };
  link(writer, taskId);
  meter(writer, taskId, meterTimes);
  const planner = writer.activeRun(taskId);
  if (!planner) return;
  step(() => writer.send({ type: 'agent.propose_plan', runId: planner.id, document: PLAN }));
  const planGate = writer.openGate(taskId);
  if (planGate)
    step(() =>
      writer.send({ type: 'gate.answer', gateId: planGate.id, decision: 'approve', response: null })
    );
  for (let index = 0; index < PLAN.phases.length; index += 1) {
    link(writer, taskId);
    meter(writer, taskId, meterTimes);
    const run = writer.activeRun(taskId);
    if (!run) return;
    step(() =>
      writer.send({
        type: 'agent.complete_phase',
        runId: run.id,
        summary: `Phase ${index + 1} is done: the writer retries, every error kind has a test and the benchmark holds.`,
        spots: [
          { file: 'src/export/write.ts', start: 10, end: 42, attention: 'critical', why: 'The retry.' },
        ],
        judgementCalls: [],
      })
    );
  }
  if (random() < 0.15) return;
  step(() => writer.send({ type: 'checks.record', taskId, results: PASSING }));
  link(writer, taskId);
  meter(writer, taskId, meterTimes);
  const reviewer = writer.activeRun(taskId);
  if (!reviewer) return;
  step(() => writer.send({ type: 'agent.report_review', runId: reviewer.id, summary: null, findings: [] }));
  if (random() < 0.2) return;
  const review = writer.openGate(taskId);
  if (!review) return;
  step(() => writer.send({ type: 'gate.answer', gateId: review.id, decision: 'approve', response: null }));
  step(() => writer.send({ type: 'pull_request.record_push', taskId, sha: `sha-${writer.state.seq}` }));
  const updates = 10 + Math.floor(random() * 40);
  for (let index = 0; index < updates; index += 1) {
    step(() =>
      writer.send({
        type: 'pull_request.record',
        taskId,
        pullRequest: {
          number: 100 + index,
          url: `https://github.com/superwall/repo/pull/${100 + index}`,
          state: 'open',
          checks: index % 3 === 0 ? 'pending' : 'passing',
          unresolvedComments: index % 4,
          mergeable: true,
          updatedAt: writer.clock + index,
        },
      })
    );
  }
  if (random() < 0.3) return;
  step(() =>
    writer.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: {
        number: 100,
        url: 'https://github.com/superwall/repo/pull/100',
        state: 'merged',
        checks: 'passing',
        unresolvedComments: 0,
        mergeable: true,
        updatedAt: writer.clock,
      },
    })
  );
}

function createTasks(writer: Writer, count: number) {
  const repoIds = REPOS.map((name) => {
    writer.send({
      type: 'repo.register',
      repo: {
        name,
        path: `/code/${name}`,
        defaultBranch: 'main',
        remote: `github.com/superwall/${name}`,
        checkCommands: ['bun lint', 'bun check-types'],
      },
      projectName: 'Superwall',
    });
    return Object.values(writer.state.repos).find((repo) => repo.name === name)?.id ?? '';
  });
  const taskIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const repoId = repoIds[index % repoIds.length] ?? '';
    const before = new Set(Object.keys(writer.state.tasks));
    writer.send({
      type: 'task.create',
      request: `Task ${index}: make the export of report ${index} retry on timeouts and say which chunk failed when it gives up.`,
      repoId,
    });
    const taskId = Object.keys(writer.state.tasks).find((id) => !before.has(id)) ?? '';
    writer.send({
      type: 'task.triage',
      taskId,
      title: `Retry export chunk writes (${index})`,
      repoId,
      size: 'small',
      branch: `fix/export-${index}`,
      waitsOn: [],
    });
    writer.send({ type: 'config.record', taskId, problems: [] });
    writer.send({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: `fix/export-${index}` });
    taskIds.push(taskId);
  }
  return taskIds;
}

function writeTranscript(dir: string, runId: string, entries: number) {
  const lines: string[] = [];
  for (let index = 0; index < entries; index += 1) {
    const callId = `call-${index}`;
    const entry: ChatEntry =
      index % 3 === 0
        ? {
            v: CHAT_PROTOCOL_VERSION,
            id: `${runId}-${index}`,
            at: index,
            type: 'agent',
            phase: 'interim',
            text: `Reading the writer to see where a chunk write can time out (${index}).`,
          }
        : index % 3 === 1
          ? {
              v: CHAT_PROTOCOL_VERSION,
              id: `${runId}-${index}`,
              at: index,
              type: 'tool_call',
              callId,
              tool: { kind: 'read', path: 'src/export/write.ts', range: { start: 1, end: 120 } },
            }
          : {
              v: CHAT_PROTOCOL_VERSION,
              id: `${runId}-${index}`,
              at: index,
              type: 'tool_result',
              callId,
              status: 'ok',
              output:
                'export async function writeChunk(chunk: Chunk) {\n  await disk.write(chunk.path, chunk.bytes);\n}\n'.repeat(
                  4
                ),
              images: [],
            };
    lines.push(JSON.stringify(entry));
  }
  writeFileSync(join(dir, `${runId}.jsonl`), `${lines.join('\n')}\n`);
}

export function writeSyntheticData(dataDir: string, options: SyntheticOptions = LARGE) {
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(join(dataDir, 'transcripts'), { recursive: true });
  const log = new EventLog(join(dataDir, 'shinsa.sqlite'));
  const writer = new Writer(log);
  const random = createRandom(7);
  const taskIds = createTasks(writer, options.tasks);
  const perTask = Math.max(1, Math.floor(options.targetEvents / options.tasks / 12));
  for (const [index, taskId] of taskIds.entries()) {
    walkTask(writer, taskId, random, perTask);
    if (index % 3 === 0) brief(writer, taskIds);
  }
  for (let index = 0; writer.state.seq < options.targetEvents; index += 1)
    reprioritize(writer, taskIds, index);
  const runIds = Object.keys(writer.state.runs);
  for (const [index, runId] of runIds.entries()) {
    const long = index < options.longTranscripts;
    writeTranscript(
      join(dataDir, 'transcripts'),
      runId,
      long ? options.longTranscriptEntries : options.shortTranscriptEntries
    );
  }
  log.close();
  return {
    events: writer.state.seq,
    tasks: taskIds.length,
    runs: runIds.length,
    longRunIds: runIds.slice(0, options.longTranscripts),
  };
}

if (import.meta.main) {
  const dir = Bun.argv[2] ?? '/tmp/shinsa-perf/large/data';
  const started = performance.now();
  const written = writeSyntheticData(dir);
  console.log(
    JSON.stringify({
      dir,
      ...written,
      longRunIds: written.longRunIds.length,
      ms: Math.round(performance.now() - started),
    })
  );
}
