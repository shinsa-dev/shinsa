import type {
  ChatTool,
  CodeSpot,
  PlanDocument,
  Repo,
  ReviewFinding,
  RunUsage,
} from '../packages/core/src/index.ts';
import { resolveLine } from './seed-code-kit.ts';
import {
  createPlanCheck,
  HOUR,
  MINUTE,
  NOW,
  type SeedReport,
  type SeedTask,
  type TimedSeedEvent,
} from './seed-kit.ts';

export const EXPORT_ROWS = `import { clickhouse } from '../clickhouse';

export interface App {
  id: string;
  eventCount: number;
}

export interface Chunk {
  start: number;
  end: number;
}

export async function readRows(app: App, start: number, end: number) {
  const result = await clickhouse.query({
    query:
      'SELECT * FROM paywall_events WHERE app_id = {app:String} ORDER BY id LIMIT {limit:UInt32} OFFSET {offset:UInt32}',
    query_params: { app: app.id, limit: end - start, offset: start },
    format: 'JSONEachRow',
  });
  return result.json();
}
`;

export const EXPORT_CHUNKS_BASE = `import { clickhouse } from '../clickhouse';
import { type App, type Chunk, readRows } from './rows';

export const CHUNK_ROWS = 50_000;

export function planChunks(rowCount: number): Chunk[] {
  const chunks: Chunk[] = [];
  for (let start = 0; start < rowCount; start += CHUNK_ROWS) {
    chunks.push({ start, end: Math.min(start + CHUNK_ROWS, rowCount) });
  }
  return chunks;
}

export async function writeChunk(app: App, chunk: Chunk) {
  await clickhouse.insert({
    table: 'paywall_events_export',
    values: await readRows(app, chunk.start, chunk.end),
    format: 'JSONEachRow',
  });
}
`;

export const EXPORT_CHUNKS_NEW = `import { clickhouse } from '../clickhouse';
import { type App, type Chunk, readRows } from './rows';

export const CHUNK_ROWS = 50_000;
export const BATCH_ROWS = 5_000;
const MAX_ATTEMPTS = 3;

export function planChunks(rowCount: number, from = 0): Chunk[] {
  const chunks: Chunk[] = [];
  for (let start = from; start < rowCount; start += CHUNK_ROWS) {
    chunks.push({ start, end: Math.min(start + CHUNK_ROWS, rowCount) });
  }
  return chunks;
}

export async function writeChunkWithRetry(app: App, chunk: Chunk) {
  let written = chunk.start;
  for (let attempt = 1; ; attempt += 1) {
    try {
      while (written < chunk.end) {
        const end = Math.min(written + BATCH_ROWS, chunk.end);
        await writeBatch(app, written, end);
        written = end;
      }
      return;
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw error;
    }
  }
}

async function writeBatch(app: App, start: number, end: number) {
  await clickhouse.insert({
    table: 'paywall_events_export',
    values: await readRows(app, start, end),
    format: 'JSONEachRow',
    clickhouse_settings: { insert_deduplication_token: \`\${app.id}:\${start}:\${end}\` },
  });
}
`;

export const EXPORT_RUN_BASE = `import { db } from '../db';
import { planChunks, writeChunk } from './chunks';
import type { App } from './rows';

export async function runExport(app: App, exportId: string) {
  const chunks = planChunks(app.eventCount);
  for (const chunk of chunks) await writeChunk(app, chunk);
  await db.export.update({ where: { id: exportId }, data: { status: 'done', finishedAt: new Date() } });
}
`;

export const EXPORT_RUN_NEW = `import { db } from '../db';
import { logger } from '../logger';
import { planChunks, writeChunkWithRetry } from './chunks';
import type { App } from './rows';

export async function runExport(app: App, exportId: string) {
  const row = await db.export.findUniqueOrThrow({ where: { id: exportId } });
  let offset = row.offset;
  for (const chunk of planChunks(app.eventCount, offset)) {
    await writeChunkWithRetry(app, chunk);
    offset = chunk.end;
    await db.export.update({ where: { id: exportId }, data: { offset } });
    logger.info('export.chunk', { appId: app.id, exportId, offset });
  }
  await db.export.update({ where: { id: exportId }, data: { status: 'done', finishedAt: new Date() } });
}
`;

export const EXPORT_MIGRATION_NEW = `ALTER TABLE exports
  ADD COLUMN "offset" integer NOT NULL DEFAULT 0;
`;

export const EXPORT_TEST_NEW = `import { describe, expect, it } from 'bun:test';
import { planChunks } from './chunks';

describe('planChunks', () => {
  it('starts from the saved offset', () => {
    expect(planChunks(120_000, 50_000)).toEqual([
      { start: 50_000, end: 100_000 },
      { start: 100_000, end: 120_000 },
    ]);
  });

  it('plans nothing once the export is finished', () => {
    expect(planChunks(120_000, 120_000)).toEqual([]);
  });
});
`;

const EXPORT_PATHS = {
  run: 'src/export/clickhouse.ts',
  chunks: 'src/export/chunks.ts',
  rows: 'src/export/rows.ts',
  migration: 'migrations/0042_export_offset.sql',
  test: 'src/export/chunks.test.ts',
};

export const EXPORT_FILES_BASE: Record<string, string> = {
  [EXPORT_PATHS.run]: EXPORT_RUN_BASE,
  [EXPORT_PATHS.chunks]: EXPORT_CHUNKS_BASE,
  [EXPORT_PATHS.rows]: EXPORT_ROWS,
};

export const EXPORT_FILES_NEW: Record<string, string> = {
  [EXPORT_PATHS.run]: EXPORT_RUN_NEW,
  [EXPORT_PATHS.chunks]: EXPORT_CHUNKS_NEW,
  [EXPORT_PATHS.migration]: EXPORT_MIGRATION_NEW,
  [EXPORT_PATHS.test]: EXPORT_TEST_NEW,
};

interface SpotNote {
  title: string;
  why: string;
  explain: string;
}

function resolveSpot(
  file: string,
  content: string,
  [from, to]: [string, string],
  attention: CodeSpot['attention'],
  note: SpotNote
): CodeSpot {
  return { file, start: resolveLine(content, from), end: resolveLine(content, to), attention, ...note };
}

function resolveRange(content: string, from: string, to: string) {
  return { line: resolveLine(content, from), end: resolveLine(content, to) };
}

function createRunUsage(costUsd: number | null, tokens: number): RunUsage {
  return {
    inputTokens: Math.round(tokens * 0.2),
    outputTokens: Math.round(tokens * 0.05),
    cacheReadTokens: Math.round(tokens * 0.7),
    cacheWriteTokens: Math.round(tokens * 0.05),
    costUsd,
  };
}

const WEEKLY_RESET = NOW + 3 * 24 * HOUR;

function createWeeklyRun(
  runId: string,
  from: number,
  to: number,
  usage: RunUsage,
  [before, after]: [number, number]
): TimedSeedEvent[] {
  const attempt = {
    type: 'run.attempted' as const,
    runId,
    attemptId: `${runId}-attempt`,
    provider: 'claude',
    model: null,
    resumed: false,
    handoff: null,
    account: { id: 'seed-work', email: 'work@example.com' },
  };
  const readings = [
    { percent: before, at: from, resetsAt: WEEKLY_RESET },
    { percent: after, at: to, resetsAt: WEEKLY_RESET },
  ];
  return [
    { at: from, event: attempt },
    { at: to, event: { type: 'run.metered', runId, usage, readings } },
  ];
}

const RATE_LIMIT_PLAN: PlanDocument = {
  goal: 'Rate-limit the public paywall API per app, so one noisy app cannot starve the others.',
  phases: [
    { title: 'Add a token bucket', detail: 'One bucket per app key, in Redis, refilled every second.' },
    { title: 'Apply it to the routes', detail: 'Every public route checks the bucket before it runs.' },
    { title: 'Answer with 429', detail: 'Over the limit returns 429 with a Retry-After header.' },
  ],
  behaviour: ['An app over its limit gets 429 with Retry-After.', 'Other apps are unaffected.'],
  approach: 'A sliding token bucket in Redis keyed by app id, checked in the API middleware.',
  files: [{ path: 'src/api/middleware/rate-limit.ts', change: 'New middleware.' }],
  outOfScope: ['Per-user limits.'],
  verification: [
    createPlanCheck('Token bucket per app', 'bun test src/api/middleware/rate-limit.test.ts', [1, 2, 3]),
  ],
  questions: [],
};

const DOCS_SEARCH_PLAN: PlanDocument = {
  goal: 'Search the docs from every page, from an index built with the site.',
  phases: [
    { title: 'Build the index', detail: 'Pagefind indexes every page when the site builds.' },
    { title: 'Add the search box', detail: 'A search field in the header opens the results under it.' },
  ],
  behaviour: ['Typing in the header lists matching pages.'],
  approach: 'A static Pagefind index, so the docs need no search server.',
  files: [{ path: 'docs/astro.config.mjs', change: 'Run Pagefind after the build.' }],
  outOfScope: ['Searching the API reference.'],
  verification: [createPlanCheck('Docs build', 'bun run --cwd docs build', [1, 2])],
  questions: [],
};

const RATE_LIMIT_REVISED: PlanDocument = {
  ...RATE_LIMIT_PLAN,
  phases: [
    RATE_LIMIT_PLAN.phases[0] as PlanDocument['phases'][number],
    { title: 'Read limits from the plan', detail: 'Each billing plan sets its own requests per second.' },
    {
      title: 'Apply it to the routes',
      detail: 'Every public route checks the app’s bucket at its plan’s rate.',
    },
    RATE_LIMIT_PLAN.phases[2] as PlanDocument['phases'][number],
  ],
  approach:
    'A sliding token bucket in Redis keyed by app id, sized from the app’s billing plan, checked in the API middleware.',
};

function createPlanHandover(document: PlanDocument): ChatTool {
  const { goal, phases } = document;
  return { kind: 'shinsa', name: 'propose_plan', args: { goal, phases } };
}

const ESCALATED_FINDINGS: ReviewFinding[] = [
  {
    severity: 'blocking',
    file: EXPORT_PATHS.chunks,
    ...resolveRange(EXPORT_CHUNKS_NEW, 'let written = chunk.start;', 'written = end;'),
    title: 'The retry offset lives only in memory',
    message:
      '`written` is never stored, and the export row only moves after a whole chunk. A restart mid-chunk starts that chunk from its first row again and relies on deduplication tokens that may have expired.',
    fix: 'Write the batch offset to the export row after every batch and start `written` from it, so a restart resumes at the last batch ClickHouse acknowledged.',
  },
  {
    severity: 'blocking',
    file: EXPORT_PATHS.chunks,
    ...resolveRange(EXPORT_CHUNKS_NEW, 'catch (error)', 'if (attempt >= MAX_ATTEMPTS)'),
    title: 'Retries have no backoff',
    message: 'Three retries with no backoff hammer ClickHouse when it is already slow.',
    fix: 'Wait between attempts, doubling each time:\n\n```ts\nawait sleep(500 * 2 ** attempt);\n```',
  },
  {
    severity: 'optional',
    file: null,
    line: null,
    title: 'Retries are invisible in the logs',
    message: 'Log the attempt number so a slow export is easy to spot.',
    fix: 'Add `attempt` to the export log line.',
  },
];

const EXPORT_CHECKPOINT_CALL = 'Checkpointed the offset once per chunk, not per batch';

const EXPORT_REPORT: SeedReport = {
  headline:
    'Export retries resume inside the chunk that failed, and a restart resumes from the last finished chunk.',
  sections: [
    {
      title: 'Find where the export loses its place',
      summary:
        'runExport walked every chunk once and kept no state, so one timeout failed the export and a restart began at row 0. It now reads the offset from the export row and writes it back after each chunk.',
      spots: [
        resolveSpot(
          EXPORT_PATHS.run,
          EXPORT_RUN_NEW,
          ['let offset = row.offset;', 'data: { offset } });'],
          'critical',
          {
            title: 'Resume from the export row',
            why: 'This is the only place progress survives a restart. Anything written inside a chunk is lost when the worker dies.',
            explain:
              'The loop starts at the `offset` saved on the export row and plans only the chunks after it. After each chunk it moves `offset` to `chunk.end` and writes it back, so a restart picks up at the first unfinished chunk.',
          }
        ),
      ],
    },
    {
      title: 'Retry inside the chunk',
      summary:
        'writeChunkWithRetry writes a chunk in 5,000-row batches and retries from the batch that failed, up to three attempts. Each batch carries a deduplication token.',
      spots: [
        resolveSpot(
          EXPORT_PATHS.chunks,
          EXPORT_CHUNKS_NEW,
          ['let written = chunk.start;', 'written = end;'],
          'high',
          {
            title: 'Batches resume where the last attempt stopped',
            why: '`written` is in memory only: a retry resumes at the failed batch, a restart does not.',
            explain:
              '`written` tracks the first row not yet stored. Each attempt runs the `while` loop from there, so a timeout on batch 9 retries batch 9, not batches 1 to 8. The outer `for` counts attempts.',
          }
        ),
        resolveSpot(
          EXPORT_PATHS.chunks,
          EXPORT_CHUNKS_NEW,
          ['catch (error)', 'if (attempt >= MAX_ATTEMPTS) throw error;'],
          'high',
          {
            title: 'Give up after three attempts',
            why: 'Attempts follow each other immediately, with no wait in between.',
            explain:
              'Any error from a batch lands here. The third failure is rethrown and fails the export; the first two go straight back into the loop.',
          }
        ),
        resolveSpot(
          EXPORT_PATHS.chunks,
          EXPORT_CHUNKS_NEW,
          ["format: 'JSONEachRow',", 'insert_deduplication_token'],
          'normal',
          {
            title: 'Replayed batches are dropped by ClickHouse',
            why: 'Only as safe as the deduplication window on the table.',
            explain:
              'The token is the app id plus the batch’s row range. When a retry or a restart sends a batch ClickHouse already stored, the insert is accepted and the duplicate rows are discarded.',
          }
        ),
      ],
    },
    {
      title: 'Test the planning',
      summary: 'Two tests cover planning from a saved offset; the retry loop has no test yet.',
      spots: [
        resolveSpot(
          EXPORT_PATHS.test,
          EXPORT_TEST_NEW,
          ["it('starts from the saved offset'", '{ start: 100_000, end: 120_000 },'],
          'normal',
          {
            title: 'Planning from an offset',
            why: 'Covers the arithmetic, not the retries or the restart.',
            explain:
              'An app with 120,000 events and 50,000 already written plans exactly two chunks, the second one short. The other test checks that a finished export plans nothing.',
          }
        ),
      ],
    },
  ],
  judgementCalls: [
    {
      title: 'Checkpoint once per chunk',
      call: EXPORT_CHECKPOINT_CALL,
      reason:
        'A chunk is ten batches. Writing the export row per batch is ten updates per 50,000 rows on a row the dashboard polls for progress; the deduplication tokens cover the batches a restart replays.',
      file: EXPORT_PATHS.run,
      ...resolveRange(EXPORT_RUN_NEW, 'offset = chunk.end;', 'data: { offset } });'),
      alternatives: [
        {
          option: 'Write the offset after every 5,000-row batch',
          rejected:
            'Ten times the writes to a row that is already read every few seconds while the export runs.',
        },
        {
          option: 'Keep the offset in Redis',
          rejected:
            'A second store to keep in step for one integer, when the export row is read at the start anyway.',
        },
      ],
    },
    {
      title: 'Deduplicate replayed inserts',
      call: 'Made replays safe with insert_deduplication_token',
      reason:
        'Any retry or restart can resend a batch ClickHouse already stored. A token per batch lets ClickHouse drop the copy without the export having to know what landed.',
      file: EXPORT_PATHS.chunks,
      line: resolveLine(EXPORT_CHUNKS_NEW, 'insert_deduplication_token'),
      end: null,
      alternatives: [
        {
          option: 'Delete the chunk’s rows before writing it again',
          rejected:
            'A delete on every retry on a table that is being written to, and the rows briefly vanish from the export.',
        },
        {
          option: 'Switch the table to ReplacingMergeTree',
          rejected:
            'Duplicates only collapse on merge, so a read in between still counts them twice, and it changes the table for every reader.',
        },
      ],
    },
    {
      title: 'Three attempts per chunk',
      call: 'Three attempts per chunk, resuming at the failed batch',
      reason:
        'Three is what the runbook told support to do by hand. Resuming at `written` means a late timeout costs one batch, not the whole chunk.',
      file: EXPORT_PATHS.chunks,
      ...resolveRange(
        EXPORT_CHUNKS_NEW,
        'for (let attempt = 1; ; attempt += 1)',
        'if (attempt >= MAX_ATTEMPTS)'
      ),
      alternatives: [
        {
          option: 'Retry the whole export from the top',
          rejected: 'What support did by hand; the largest app took most of a day.',
        },
        {
          option: 'Retry with the official client’s built-in retries',
          rejected:
            'The client retries a request, not a batch, so it cannot resume from `written` and does not know about the tokens.',
        },
      ],
    },
  ],
  walkthrough: {
    approach:
      'A ClickHouse export used to be one pass: plan 50,000-row chunks, insert each one, mark the export done. A timeout anywhere failed the export, and starting again began at row 0.\n\nThe fix works at two levels. Inside a chunk, `writeChunkWithRetry` writes 5,000-row batches and retries from the batch that failed, up to three attempts. Across restarts, `runExport` saves the finished offset on the export row after every chunk and plans only what is left. A new `offset` column holds it.\n\nBecause both levels can resend rows, every batch carries an `insert_deduplication_token`, so a batch ClickHouse already has is dropped instead of doubled.',
    flow: '1. `runExport` reads the export row and its `offset` (0 for a new export).\n2. `planChunks(app.eventCount, offset)` lists the chunks from there on.\n3. For each chunk, `writeChunkWithRetry` reads and inserts 5,000 rows at a time, tagging each insert with `app:start:end`.\n4. A failed batch throws into the `catch`; the next attempt resumes at `written`. The third failure fails the export.\n5. When a chunk finishes, `runExport` writes `chunk.end` to the export row and logs it.\n6. After the last chunk the row is marked done.\n\n```text\nrunExport\n  │ offset ◀── exports.offset           0 for a new export\n  ▼\nplanChunks(count, offset) ──▶ [chunk, chunk, ...]\n  │\n  ▼ for each chunk\nwriteChunkWithRetry ──▶ batch ──▶ clickhouse.insert(token)\n  │   ▲                   │\n  │   └─ retry, 3 tries ──┘\n  ▼\nexports.offset = chunk.end              a restart resumes here\n```\n\nA restart re-enters at step 1 with the saved offset, so at most one chunk is written again, and the tokens drop the batches that already landed.',
    risks: [
      {
        title: 'Offsets shift during an export',
        risk: '`readRows` pages with `ORDER BY id` and `OFFSET`. Events written while the export runs shift the offsets, so a resumed export can skip or repeat rows near the edge.',
        file: EXPORT_PATHS.rows,
        line: resolveLine(EXPORT_ROWS, 'ORDER BY id LIMIT'),
        end: null,
      },
      {
        title: 'Old batches can write twice',
        risk: 'ClickHouse remembers only the most recent deduplication tokens per table. On a busy table, a restart that replays an older batch can write it twice.',
        file: EXPORT_PATHS.chunks,
        line: resolveLine(EXPORT_CHUNKS_NEW, 'insert_deduplication_token'),
        end: null,
      },
      {
        title: 'Late events wait for the next export',
        risk: '`app.eventCount` is read when the export starts. Events that arrive later are left for the next export.',
        file: EXPORT_PATHS.run,
        line: resolveLine(EXPORT_RUN_NEW, 'planChunks(app.eventCount, offset)'),
        end: null,
      },
      {
        title: 'Permanent errors are retried',
        risk: 'Every error is retried, including ones that will never pass, such as a revoked password or a schema mismatch. Those take three attempts to surface.',
        file: EXPORT_PATHS.chunks,
        ...resolveRange(EXPORT_CHUNKS_NEW, 'catch (error)', 'if (attempt >= MAX_ATTEMPTS)'),
      },
    ],
    testing: {
      automated: [
        '`chunks.test.ts` covers planning from a saved offset and an export with nothing left to write.',
        'The retry loop and the restart have no automated test: the ClickHouse client is not mocked anywhere in this repository yet.',
      ],
      manual: [
        {
          action: 'Apply the migration to staging so the export row has an `offset` column.',
          target: { kind: 'file', value: EXPORT_PATHS.migration },
          expect: '`offset` exists on the export table with a default of 0.',
        },
        {
          action: 'Start an export for a large staging app and follow the worker log.',
          target: { kind: 'command', value: 'bun run export:worker --app staging-large' },
          expect: 'One `export.chunk` line per chunk, each with a higher `offset`.',
        },
        {
          action: 'Kill the worker after a few chunks, then start it again.',
          target: null,
          expect: 'It resumes at the last logged `offset`, not at row 0.',
        },
        {
          action: 'Compare the saved `offset` with the rows in `paywall_events_export` for that app.',
          target: null,
          expect: 'The row count matches the offset, with no chunk written twice.',
        },
        {
          action: 'Set `max_execution_time = 1` on the staging ClickHouse user and start another export.',
          target: null,
          expect:
            'Each chunk gives up after three attempts and the export fails with the timeout in its error.',
        },
        {
          action: 'Read where the offset is saved after each chunk.',
          target: {
            kind: 'file',
            value: `${EXPORT_PATHS.run}:${resolveLine(EXPORT_RUN_NEW, 'let offset = row.offset;')}-${resolveLine(EXPORT_RUN_NEW, 'data: { offset } });')}`,
          },
          expect:
            'The offset moves only after a whole chunk is written, so a restart repeats at most one chunk.',
        },
      ],
    },
  },
};

interface SeedRepoPair {
  paywall: Repo;
  kanna: Repo;
}

function listLimitTasks({ paywall, kanna }: SeedRepoPair, exportBackoffPath: string): SeedTask[] {
  return [
    {
      id: 'task-rate-limit',
      request: 'Rate-limit the public paywall API per app',
      title: 'Rate-limit the public API per app',
      repo: paywall,
      size: 'large',
      planFirst: true,
      stage: 'awaiting_plan',
      reason: 'needs the revised plan approved',
      branch: 'feat/api-rate-limit',
      ageHours: 3,
      plan: RATE_LIMIT_PLAN,
      runs: [
        {
          role: 'agent',
          purpose: 'plan',
          minutes: 6,
          summary: 'Proposed a token bucket per app.',
          handover: createPlanHandover(RATE_LIMIT_PLAN),
        },
        {
          role: 'agent',
          purpose: 'plan',
          minutes: 4,
          summary: 'Revised the plan to read limits from the billing plan.',
          handover: createPlanHandover(RATE_LIMIT_REVISED),
        },
      ],
      timed: createWeeklyRun(
        'task-rate-limit-run-0',
        NOW - 2.9 * HOUR,
        NOW - 2.8 * HOUR,
        createRunUsage(1, 600_000),
        [52, 54]
      ),
      extra: [
        {
          type: 'plan.proposed',
          taskId: 'task-rate-limit',
          body: RATE_LIMIT_REVISED.goal,
          document: RATE_LIMIT_REVISED,
        },
      ],
      gate: {
        type: 'plan',
        title: 'Approve the rate-limit plan',
        body: 'Version 2 reads limits from the billing plan.',
        details: { planVersion: 2 },
      },
    },
    {
      id: 'task-docs-search',
      request: 'Add search to the docs site',
      title: 'Add search to the docs',
      repo: paywall,
      size: 'small',
      stage: 'awaiting_plan',
      reason: 'in the backlog',
      priority: 'low',
      branch: 'feat/docs-search',
      ageHours: 30,
      plan: DOCS_SEARCH_PLAN,
      runs: [
        {
          role: 'agent',
          purpose: 'plan',
          minutes: 5,
          summary: 'Planned a static search index for the docs.',
          handover: createPlanHandover(DOCS_SEARCH_PLAN),
        },
      ],
      extra: [{ type: 'task.backlog_changed', taskId: 'task-docs-search', backlog: true, cause: 'you' }],
      gate: { type: 'plan', title: 'Add search to the docs', body: DOCS_SEARCH_PLAN.goal },
    },
    {
      id: 'task-export-backoff',
      request: 'ClickHouse export retries need to survive a restart',
      title: 'Make export retries survive a restart',
      repo: paywall,
      size: 'small',
      stage: 'awaiting_review',
      reason: 'the agents could not settle the review',
      branch: 'fix/export-retry-restart',
      ageHours: 4,
      worktreePath: exportBackoffPath,
      verification: [createPlanCheck('Export chunk plan', `bun test ${EXPORT_PATHS.test}`, [1, 2, 3])],
      checkResults: { c1: { detail: '2 new' } },
      summary: 'Retries now resume from the last written chunk.',
      report: EXPORT_REPORT,
      reviewSummary:
        'I checked the fix round against the same two findings. The offset still lives in memory and the retries still have no backoff, so a restart or a slow ClickHouse breaks the export.',
      findings: ESCALATED_FINDINGS,
      reviewDisagreements: [
        {
          call: EXPORT_CHECKPOINT_CALL,
          reason:
            'Checkpointing per chunk is what lets a restart replay up to 45,000 rows, and the deduplication window is too short to rely on for a busy table. Per batch costs one small update per 5,000 rows.',
        },
      ],
      runs: [
        { role: 'agent', purpose: 'build', minutes: 9, summary: 'Persisted the chunk offset.' },
        { role: 'reviewer', minutes: 3, summary: 'Two blocking findings.' },
        {
          role: 'agent',
          purpose: 'fix',
          fix: 'review',
          minutes: 6,
          summary: 'Moved the offset into the export row.',
        },
        { role: 'reviewer', minutes: 3, summary: 'The same two findings again.' },
      ],
      timed: [
        ...createWeeklyRun(
          'task-export-backoff-run-0',
          NOW - 3.6 * HOUR,
          NOW - 3.5 * HOUR,
          createRunUsage(1.84, 920_000),
          [44, 48]
        ),
        ...createWeeklyRun(
          'task-export-backoff-run-1',
          NOW - 3.45 * HOUR,
          NOW - 3.4 * HOUR,
          createRunUsage(0.31, 210_000),
          [48, 49]
        ),
        ...createWeeklyRun(
          'task-export-backoff-run-2',
          NOW - 3.35 * HOUR,
          NOW - 3.25 * HOUR,
          createRunUsage(1.12, 640_000),
          [49, 52]
        ),
        ...createWeeklyRun(
          'task-export-backoff-run-3',
          NOW - 3.2 * HOUR,
          NOW - 3.15 * HOUR,
          createRunUsage(0.29, 190_000),
          [52, 52]
        ),
      ],
      extra: [
        {
          type: 'review.escalated',
          taskId: 'task-export-backoff',
          escalation: { reason: 'rounds', rounds: 2, at: NOW - 20 * MINUTE },
        },
        {
          type: 'task.suggested',
          taskId: 'task-export-backoff',
          suggestion: {
            id: 'suggestion-export-metrics',
            runId: 'task-export-backoff-run-1',
            title: 'Chart export durations per app',
            request:
              'Add a dashboard panel with ClickHouse export durations per app, so slow exports show up early.',
            why: 'The review found slow exports only by reading logs.',
            waitsOnThis: true,
            status: 'open',
            createdTaskId: null,
            suggestedAt: NOW - 25 * MINUTE,
          },
        },
      ],
      gate: {
        type: 'review',
        title: 'Decide on the review findings',
        body: 'The reviewer still had blocking findings after 2 fix rounds.',
        details: { escalation: { reason: 'rounds', rounds: 2, at: NOW - 20 * MINUTE } },
      },
    },
    {
      id: 'task-kanna-setup',
      request: 'add keyboard shortcuts to the kanna sidebar',
      title: 'Keyboard shortcuts in the sidebar',
      repo: kanna,
      size: 'small',
      stage: 'triage',
      reason: 'waiting for the setup to be fixed',
      branch: 'feat/sidebar-shortcuts',
      ageHours: 1,
      extra: [
        {
          type: 'config.verified',
          taskId: 'task-kanna-setup',
          problems: [
            {
              kind: 'default_branch',
              detail: 'The default branch “main” is not in the repository or on origin.',
            },
          ],
        },
      ],
      gate: {
        type: 'configuration',
        title: 'The default branch is missing',
        body: [
          'Shinsa stopped before any agent started because the setup is not complete:',
          '- The default branch “main” is not in the repository or on origin.',
          '',
          'Set the default branch in the repository settings, then verify the setup again.',
        ].join('\n'),
      },
    },
  ];
}

function listWaitTasks({ paywall }: SeedRepoPair): SeedTask[] {
  return [
    {
      id: 'task-staging-deploy',
      request: 'verify the paywall CDN purge on staging after the deploy',
      title: 'Verify the CDN purge on staging',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'waiting for the staging deploy',
      branch: 'fix/cdn-purge',
      ageHours: 1.5,
      runs: [
        {
          role: 'agent',
          purpose: 'build',
          minutes: 7,
          summary: 'Purged the CDN; waiting for the deploy to verify.',
        },
      ],
      extra: [
        {
          type: 'run.ended',
          runId: 'task-staging-deploy-run-0',
          outcome: 'completed',
          summary: 'Waiting for the staging deploy.',
        },
        {
          type: 'monitor.armed',
          taskId: 'task-staging-deploy',
          monitor: {
            id: 'monitor-staging',
            runId: 'task-staging-deploy-run-0',
            role: 'agent',
            phaseIndex: 1,
            notes: 'The staging deploy of `main@4f2c1e9`. Ready when /healthz reports that sha.',
            armedAt: NOW - 18 * MINUTE,
            nextCheckAt: NOW + 12 * MINUTE,
            timeoutAt: NOW + 3 * 60 * MINUTE,
            attempts: 1,
            maxAttempts: 10,
            status: 'armed',
          },
        },
      ],
    },
    {
      id: 'task-wait-ran-out',
      request: 'confirm the new pricing page renders on the production CDN after the release',
      title: 'Confirm the pricing page on the CDN',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'paused',
      branch: 'fix/pricing-cdn-check',
      ageHours: 6,
      runs: [{ role: 'agent', purpose: 'build', minutes: 5, summary: 'The wait ran out.' }],
      timed: createWeeklyRun(
        'task-wait-ran-out-run-0',
        NOW - 5.9 * HOUR,
        NOW - 5.8 * HOUR,
        createRunUsage(0.9, 520_000),
        [42, 44]
      ),
      extra: [
        {
          type: 'run.ended',
          runId: 'task-wait-ran-out-run-0',
          outcome: 'completed',
          summary: 'The wait ran out.',
        },
        {
          type: 'monitor.armed',
          taskId: 'task-wait-ran-out',
          monitor: {
            id: 'monitor-pricing',
            runId: 'task-wait-ran-out-run-0',
            role: 'agent',
            phaseIndex: 1,
            notes: 'The 2.14 release on the production CDN. Ready when /pricing serves the new hero.',
            armedAt: NOW - 5 * 60 * MINUTE,
            nextCheckAt: NOW - 30 * MINUTE,
            timeoutAt: NOW + 19 * 60 * MINUTE,
            attempts: 10,
            maxAttempts: 10,
            status: 'armed',
          },
        },
        {
          type: 'monitor.ended',
          taskId: 'task-wait-ran-out',
          monitorId: 'monitor-pricing',
          status: 'exhausted',
        },
      ],
      gate: {
        type: 'failure',
        title: 'The agent’s wait ran out of checks',
        body: 'The agent was waiting for: The 2.14 release on the production CDN. Ready when /pricing serves the new hero.\n\nThe agent used all 10 checks and still needed to wait. Retry to wake an agent with a fresh set of checks, or cancel the task.',
        details: { cause: 'monitor', runId: null },
      },
    },
    {
      id: 'task-quiet-build',
      request: 'regenerate the paywall template thumbnails',
      title: 'Regenerate the template thumbnails',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'building',
      branch: 'chore/template-thumbnails',
      ageHours: 0.8,
      runs: [{ role: 'agent', purpose: 'build', minutes: 30, summary: 'Rendering every template.' }],
      extra: [{ type: 'run.silenced', runId: 'task-quiet-build-run-0', since: NOW - 22 * MINUTE }],
    },
  ];
}

function listBudgetTasks({ paywall }: SeedRepoPair): SeedTask[] {
  return [
    {
      id: 'task-budget-cap',
      request: 'migrate the paywall analytics to the new event schema',
      title: 'Migrate analytics to the new event schema',
      repo: paywall,
      size: 'large',
      stage: 'building',
      reason: 'reached its usage limit',
      branch: 'refactor/analytics-schema',
      ageHours: 7,
      runs: [
        { role: 'agent', purpose: 'plan', minutes: 6, summary: 'Planned four phases.' },
        { role: 'agent', purpose: 'build', minutes: 40, summary: 'Ported the first two event families.' },
      ],
      extra: [
        {
          type: 'run.ended',
          runId: 'task-budget-cap-run-1',
          outcome: 'completed',
          summary: 'Ported the first two event families.',
        },
      ],
      timed: [
        ...createWeeklyRun(
          'task-budget-cap-run-0',
          NOW - 6.8 * HOUR,
          NOW - 6.7 * HOUR,
          createRunUsage(0.62, 380_000),
          [30, 31]
        ),
        ...createWeeklyRun(
          'task-budget-cap-run-1',
          NOW - 6.6 * HOUR,
          NOW - 6 * HOUR,
          createRunUsage(4.71, 2_600_000),
          [31, 42]
        ),
      ],
      gate: {
        type: 'failure',
        title: 'Reached its usage limit',
        body: 'This task reached its usage limit of 10% of the weekly limit, so the next step did not start. Continue to allow another 10%, or cancel the task.',
        details: { cause: 'budget', runId: null },
      },
    },
    {
      id: 'task-retry-question',
      request: 'retry webhook deliveries that fail',
      title: 'Retry failed webhook deliveries',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'waiting on your answer',
      branch: 'fix/webhook-retries',
      ageHours: 0.5,
      runs: [{ role: 'agent', purpose: 'build', minutes: 4, summary: 'Asked how long to keep retrying.' }],
      gate: {
        type: 'question',
        title: 'How long should a failing webhook keep retrying?',
        body: 'Stripe retries for 3 days with exponential backoff. Shorter keeps the queue small; longer survives a customer outage.',
        details: { choices: ['1 hour', '24 hours', '3 days'], recommendation: '24 hours' },
      },
    },
    {
      id: 'task-ask-export',
      request: 'How does the ClickHouse export decide how big a chunk is?',
      title: 'How the export sizes its chunks',
      repo: paywall,
      size: 'small',
      shape: 'answer',
      stage: 'done',
      reason: 'answered your question',
      branch: 'ask/export-chunks',
      ageHours: 2.5,
      runs: [{ role: 'answerer', minutes: 3, summary: 'Answered the question.' }],
      timed: createWeeklyRun(
        'task-ask-export-run-0',
        NOW - 2.4 * HOUR,
        NOW - 2.35 * HOUR,
        createRunUsage(0.18, 140_000),
        [54, 54]
      ),
      extra: [
        {
          type: 'task.delivered',
          taskId: 'task-ask-export',
          step: 'answer',
          runId: 'task-ask-export-run-0',
          body: [
            'Chunks are a fixed **50,000 rows**, set by `CHUNK_ROWS` in [chunks.ts](shinsa://file/src/export/chunks.ts#L4).',
            '',
            '`planChunks` counts the rows once, then walks them in steps of that size; nothing adapts to the app’s size or to how slow ClickHouse is.',
          ].join('\n'),
        },
        {
          type: 'task.suggested',
          taskId: 'task-ask-export',
          suggestion: {
            id: 'suggestion-adaptive-chunks',
            runId: 'task-ask-export-run-0',
            title: 'Size export chunks by response time',
            request:
              'Make the ClickHouse export shrink its chunk size when a chunk takes longer than 10 seconds.',
            why: 'Fixed 50k-row chunks time out on the largest apps.',
            waitsOnThis: false,
            status: 'open',
            createdTaskId: null,
            suggestedAt: NOW - 2 * 60 * MINUTE,
          },
        },
      ],
    },
  ];
}

export function listProcessTasks(repos: SeedRepoPair, exportBackoffPath: string): SeedTask[] {
  return [...listLimitTasks(repos, exportBackoffPath), ...listWaitTasks(repos), ...listBudgetTasks(repos)];
}
