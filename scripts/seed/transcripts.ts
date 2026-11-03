import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertClaudeSession } from '../../apps/engine/src/agents/index.ts';
import {
  type RunPurpose,
  type RunRole,
  type ShinsaEventInput,
  type ChatEvent,
  type ChatTool,
  isReadOnlyRun,
  RUN_AGENT_ROLE,
} from '../../packages/core/src/index.ts';
import { callTool, NOW, resolveToolOutput, type SeedTask, say } from './kit.ts';
import { DATA } from './paths.ts';
import { resolveRunOpening } from './prompts.ts';
import { resolveShapeHandover } from './tasks/shapes.ts';
import { SMALL_PLAN } from './timeline.ts';

interface SeedRunTimes {
  task: SeedTask;
  role: RunRole;
  purpose: RunPurpose | null;
  opening: string | null;
  index: number;
  startedAt: number;
  endedAt: number | null;
  failed: boolean;
}

const SEED_FILES: Record<string, { read: string; edit: string; test: string }> = {
  'repo-paywall': {
    read: 'src/export/clickhouse.ts',
    edit: 'src/export/clickhouse.ts',
    test: 'bun test src/export',
  },
  'repo-kanna': {
    read: 'src/client/app/ChatPage/index.tsx',
    edit: 'src/server/ws-router.ts',
    test: 'bun test',
  },
};

function seedFiles(task: SeedTask) {
  return SEED_FILES[task.repo.id] ?? { read: 'src/index.ts', edit: 'src/index.ts', test: 'bun test' };
}

function listSeedDisagreements(task: SeedTask) {
  const calls = task.report?.judgementCalls ?? [];
  return (task.reviewDisagreements ?? []).map((entry) => ({
    call: calls.findIndex((call) => call.call === entry.call) + 1,
    reason: entry.reason,
  }));
}

function resolveHandover({ task, role, purpose, index }: SeedRunTimes): ChatTool {
  const seeded = task.runs?.[index]?.handover;
  if (seeded) return seeded;
  const body = task.summary ?? task.title;
  if (purpose === 'plan') {
    return { kind: 'shinsa', name: 'propose_plan', args: { goal: task.request, phases: SMALL_PLAN } };
  }
  if (purpose === 'build') return { kind: 'shinsa', name: 'complete_phase', args: { summary: body } };
  if (purpose === 'operate') return { kind: 'shinsa', name: 'report_outcome', args: { outcome: body } };
  if (role === 'reviewer') {
    const summary = task.reviewSummary ? { summary: task.reviewSummary } : {};
    return {
      kind: 'shinsa',
      name: 'report_review',
      args: { ...summary, findings: task.findings ?? [], disagreements: listSeedDisagreements(task) },
    };
  }
  return (
    resolveShapeHandover(role, body) ?? { kind: 'shinsa', name: 'complete_fix', args: { summary: body } }
  );
}

const RESULT_HAND_OVERS = new Set(['answer', 'report_diagnosis', 'submit_report', 'report_outcome']);

function resolveHandoverEnding(handover: ChatTool, reply: string): ChatEvent[] {
  const call = [callTool('handover-1', handover), resolveToolOutput('handover-1', 'Handed over.')];
  if (handover.kind === 'shinsa' && RESULT_HAND_OVERS.has(handover.name)) return [say(reply), ...call];
  return [...call, say(reply, 'final')];
}

export function buildRunEvents(times: SeedRunTimes, live: boolean): ChatEvent[] {
  const { task, role } = times;
  const files = seedFiles(task);
  const brief: ChatEvent = {
    type: 'user',
    from: 'shinsa',
    text:
      times.opening ??
      `You are the ${role} for "${task.title}".\n\nThe request: ${task.request}\n\nWork in the task's worktree and hand over through the Shinsa tools.`,
    attachments: [],
  };
  const edits: ChatEvent[] = isReadOnlyRun({ role, purpose: times.purpose ?? undefined })
    ? [
        say(
          'The chunk loop has no retry, so one slow chunk fails the whole export. The tests show where it breaks.'
        ),
      ]
    : [
        say(
          'The chunk loop has no retry, so one slow chunk fails the whole export. I will wrap the write and keep the offset.'
        ),
        callTool('edit-1', {
          kind: 'edit',
          path: files.edit,
          hunks: [
            {
              before: '  for (const chunk of chunks) await writeChunk(chunk);',
              after: '  for (const chunk of chunks) await retry(() => writeChunk(chunk), { attempts: 3 });',
            },
          ],
        }),
        resolveToolOutput('edit-1', 'The file has been updated.'),
      ];
  const work: ChatEvent[] = [
    { type: 'status', status: 'started', outcome: null },
    brief,
    say(`I'll start by reading how ${files.read.split('/').at(-1)} handles this today.`),
    callTool('read-1', { kind: 'read', path: files.read, range: { start: 1, end: 40 } }),
    resolveToolOutput(
      'read-1',
      '1\texport async function runExport(app: App) {\n2\t  const chunks = planChunks(app);\n3\t  for (const chunk of chunks) await writeChunk(chunk);\n4\t}'
    ),
    callTool('grep-1', { kind: 'search', mode: 'content', query: 'writeChunk', path: 'src' }),
    resolveToolOutput('grep-1', 'src/export/clickhouse.ts:3\nsrc/export/chunks.ts:18'),
    ...edits,
    say('Running the tests for the export now.'),
    callTool('test-1', {
      kind: 'command',
      action: 'run',
      command: files.test,
      description: 'Run the export tests',
    }),
  ];
  if (task.gate?.type === 'question' && live) {
    return [
      ...work,
      resolveToolOutput('test-1', ' 12 pass\n 0 fail'),
      say('The tests pass. One decision is yours before I go further.'),
      callTool('ask-1', {
        kind: 'shinsa',
        name: 'ask',
        args: { question: task.gate.title, context: task.gate.body },
      }),
      { type: 'status', status: 'waiting', outcome: null },
    ];
  }
  if (live) return work;
  const handover = resolveHandover(times);
  const seeded = task.runs?.[times.index];
  const summary = seeded?.summary ?? 'Done.';
  const ending: ChatEvent[] = times.failed
    ? [resolveToolOutput('test-1', ' 11 pass\n 1 fail'), { type: 'error', text: summary }]
    : [
        resolveToolOutput('test-1', ' 12 pass\n 0 fail'),
        ...resolveHandoverEnding(handover, seeded?.reply ?? summary),
      ];
  return [
    ...work,
    ...ending,
    { type: 'status', status: 'ended', outcome: times.failed ? 'failed' : 'completed' },
  ];
}

function isRunRole(role: string): role is RunRole {
  return role in RUN_AGENT_ROLE;
}

export function listRunTimes(tasks: SeedTask[], timeline: { at: number; event: ShinsaEventInput }[]) {
  const byTask = new Map(tasks.map((task) => [task.id, task]));
  const times = new Map<string, SeedRunTimes>();
  for (const { at, event } of timeline) {
    if (event.type === 'run.started') {
      const task = byTask.get(event.run.taskId);
      const index = Number(event.run.id.split('-run-').at(-1));
      const { role } = event.run;
      if (task && isRunRole(role))
        times.set(event.run.id, {
          task,
          role,
          purpose: event.run.purpose ?? null,
          opening: resolveRunOpening(event.run),
          index,
          startedAt: at,
          endedAt: null,
          failed: false,
        });
    }
    if (event.type === 'run.ended') {
      const run = times.get(event.runId);
      if (run) Object.assign(run, { endedAt: at, failed: event.outcome === 'failed' });
    }
  }
  return [...times.entries()];
}

export function writeSessionTranscript(
  session: string,
  runTimes: [string, SeedRunTimes][],
  transcripts: string
) {
  const evidence = join(DATA, 'evidence');
  let images = 0;
  const entries = convertClaudeSession(readFileSync(session, 'utf8'), (data, mediaType) => {
    images += 1;
    const file = `seed-image-${images}.${mediaType.split('/')[1] ?? 'png'}`;
    writeFileSync(join(evidence, file), Buffer.from(data, 'base64'));
    return `/api/evidence/${file}`;
  });
  const window = runTimes.find(([runId]) => runId === 'task-embedded-chat-run-1')?.[1];
  const first = entries[0]?.at ?? 0;
  const span = Math.max(1, (entries.at(-1)?.at ?? first) - first);
  const fitted = window
    ? entries.map((entry) => ({
        ...entry,
        at:
          window.startedAt +
          Math.round(((entry.at - first) / span) * ((window.endedAt ?? NOW) - window.startedAt)),
      }))
    : entries;
  writeFileSync(
    join(transcripts, 'task-embedded-chat-run-1.jsonl'),
    `${fitted.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  );
  console.info(`Seeded a crowded chat with ${entries.length} entries from ${session}`);
}
