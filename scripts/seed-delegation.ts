import type {
  ChatEvent,
  DelegateRole,
  Repo,
  Run,
  RunDelegation,
  ShinsaEventInput,
} from '../packages/core/src/index.ts';
import { resolveDeliveryPrompt } from '../packages/core/src/index.ts';
import {
  CHOSEN_BY_YOU,
  callTool,
  MINUTE,
  NO_TRIAGE_DECISIONS,
  NOW,
  resolveToolOutput,
  type SeedTask,
  say,
  spreadEvents,
  type TimedSeedEvent,
  writeTranscript,
} from './seed-kit.ts';

const RETRY = 'task-delegated-retry';

const RETRY_STEP = `${RETRY}-run-1`;

const SUITE = 'task-delegated-suite';

const SUITE_STEP = `${SUITE}-run-1`;

interface Delegate {
  id: string;
  parent: string;
  taskId: string;
  role: DelegateRole;
  title: string;
  brief: string;
  depth: number;
  startedAt: number;
  isolation?: RunDelegation['isolation'];
  mode?: RunDelegation['mode'];
  ended?: { at: number; outcome: 'completed' | 'cancelled' | 'failed'; summary: string };
}

const REVIEW_RESULT = [
  'The retry wrapper is sound. Two things to keep:',
  '',
  '- `src/export/clickhouse.ts:3` retries every error, including a 400 from a malformed chunk. Retry only on timeouts and 5xx.',
  '- `src/export/chunks.ts:18` has no backoff between attempts. 250 ms doubling is enough for ClickHouse.',
].join('\n');

const DELEGATES: Delegate[] = [
  {
    id: `${RETRY}-review`,
    parent: RETRY_STEP,
    taskId: RETRY,
    role: 'reviewer',
    title: 'Review the retry wrapper',
    brief: 'Review the retry wrapper in src/export/clickhouse.ts for errors it should not retry.',
    depth: 1,
    startedAt: NOW - 22 * MINUTE,
    ended: { at: NOW - 15 * MINUTE, outcome: 'completed', summary: REVIEW_RESULT },
  },
  {
    id: `${RETRY}-callers`,
    parent: RETRY_STEP,
    taskId: RETRY,
    role: 'planner',
    title: 'Find every caller of runExport',
    brief: 'List every caller of runExport and whether it can run twice for the same app.',
    depth: 1,
    startedAt: NOW - 14 * MINUTE,
  },
  {
    id: `${RETRY}-timeouts`,
    parent: `${RETRY}-callers`,
    taskId: RETRY,
    role: 'reviewer',
    title: 'Check the ClickHouse client timeouts',
    brief: 'Read the ClickHouse client config and report its request and socket timeouts.',
    depth: 2,
    startedAt: NOW - 9 * MINUTE,
  },
  {
    id: `${RETRY}-streaming`,
    parent: RETRY_STEP,
    taskId: RETRY,
    role: 'builder',
    title: 'Try a streaming insert instead of chunks',
    brief:
      'In your own checkout, replace the chunked insert with a streaming insert and run the export tests.',
    depth: 1,
    isolation: 'worktree',
    startedAt: NOW - 12 * MINUTE,
    ended: { at: NOW - 6 * MINUTE, outcome: 'cancelled', summary: 'Stopped by you.' },
  },
  {
    id: `${SUITE}-integration`,
    parent: SUITE_STEP,
    taskId: SUITE,
    role: 'reviewer',
    title: 'Run the slow integration suite',
    brief: 'Run bun test:integration and report every failure with its file and line.',
    depth: 1,
    mode: 'wait',
    startedAt: NOW - 11 * MINUTE,
  },
];

const QUESTION = {
  id: `${RETRY}-question`,
  question:
    'The nightly job and the admin button both call runExport. Should a second run wait or be refused?',
  context: 'A second run for the same app would write the same chunks twice.',
  choices: ['Wait for the first run', 'Refuse the second run'],
  recommendation: 'Refuse the second run',
  askedAt: NOW - 4 * MINUTE,
  delivered: true,
  answer: null,
  answeredAt: null,
};

const RETRY_BUILDER: Run = {
  id: RETRY_STEP,
  taskId: RETRY,
  role: 'builder',
  status: 'running',
  provider: 'claude',
  model: 'claude-opus-5-5',
  sessionId: null,
  startedAt: NOW - 25 * MINUTE,
  endedAt: null,
  outcome: null,
  summary: null,
};

function toRun(delegate: Delegate): Run {
  return {
    id: delegate.id,
    taskId: delegate.taskId,
    role: delegate.role,
    status: 'running',
    provider: 'claude',
    model: delegate.role === 'reviewer' ? 'claude-sonnet-5-5' : 'claude-opus-5-5',
    sessionId: null,
    startedAt: delegate.startedAt,
    endedAt: null,
    outcome: null,
    summary: null,
    delegation: {
      parentRunId: delegate.parent,
      depth: delegate.depth,
      requestKey: delegate.id,
      title: delegate.title,
      brief: delegate.brief,
      mode: delegate.mode ?? 'async',
      wake: 'always',
      isolation: delegate.isolation ?? 'shared',
      baseCommit: delegate.isolation === 'worktree' ? 'a1b2c3d' : null,
      delivery: 'none',
      question: null,
      requestedAt: delegate.startedAt,
    },
  };
}

function atMinutesAgo(minutes: number, event: ShinsaEventInput): TimedSeedEvent {
  return { at: NOW - minutes * MINUTE, event };
}

function listDelegateEvents(taskId: string): TimedSeedEvent[] {
  return DELEGATES.filter((candidate) => candidate.taskId === taskId).flatMap((delegate) => {
    const started: TimedSeedEvent = {
      at: delegate.startedAt,
      event: { type: 'run.started', run: toRun(delegate) },
    };
    if (!delegate.ended) return [started];
    const { at, outcome, summary } = delegate.ended;
    return [started, { at, event: { type: 'run.ended', runId: delegate.id, outcome, summary } }];
  });
}

function deliverResult(minutes: number, generation: number, childRunId: string): TimedSeedEvent[] {
  const items = [`result:${childRunId}`];
  return [
    atMinutesAgo(minutes, {
      type: 'delegation.claimed',
      runId: RETRY_STEP,
      claim: { generation, items, via: 'steer' },
    }),
    atMinutesAgo(minutes, {
      type: 'delegation.delivered',
      runId: RETRY_STEP,
      generation,
      items,
      via: 'steer',
    }),
  ];
}

export function listDelegationTasks({ paywall }: { paywall: Repo }): SeedTask[] {
  const review = `${RETRY}-review`;
  return [
    {
      id: RETRY,
      request: 'Retry ClickHouse export chunks with backoff, and only on errors worth retrying',
      title: 'Retry export chunks with backoff',
      repo: paywall,
      size: 'large',
      stage: 'building',
      reason: 'building the change',
      branch: 'fix/export-chunk-backoff',
      ageHours: 0.6,
      runs: [
        { role: 'planner', minutes: 4, summary: 'Planned the backoff in two phases.' },
        { role: 'builder', minutes: 25, summary: 'Building.' },
      ],
      timed: [
        ...listDelegateEvents(RETRY),
        ...deliverResult(14.5, 1, review),
        atMinutesAgo(4, { type: 'delegation.asked', runId: `${RETRY}-callers`, question: QUESTION }),
        ...deliverResult(5.5, 2, `${RETRY}-streaming`),
        atMinutesAgo(10, {
          type: 'task.created',
          taskId: 'task-courier-client-timeouts',
          request:
            'Raise the ClickHouse client request timeout in the admin app from 10 s to 60 s, so long exports stop failing there too.',
          repoId: paywall.id,
          priority: 'normal',
          planFirst: false,
          origin: null,
          auto: CHOSEN_BY_YOU,
          createdBy: { kind: 'courier', taskId: RETRY, runId: RETRY_STEP, requestKey: 'client-timeouts' },
        }),
        atMinutesAgo(9.9, {
          type: 'task.triaged',
          taskId: 'task-courier-client-timeouts',
          title: 'Raise the admin ClickHouse timeout',
          repoId: paywall.id,
          size: 'small',
          branch: 'fix/admin-clickhouse-timeout',
          decisions: NO_TRIAGE_DECISIONS,
        }),
      ],
    },
    {
      id: SUITE,
      request: 'Move the export tests onto the shared ClickHouse fixture',
      title: 'Share the ClickHouse test fixture',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'building the change',
      branch: 'chore/shared-clickhouse-fixture',
      ageHours: 0.4,
      runs: [
        { role: 'planner', minutes: 3, summary: 'Planned the move.' },
        { role: 'builder', minutes: 15, summary: 'Building.' },
      ],
      timed: [
        ...listDelegateEvents(SUITE),
        atMinutesAgo(8, {
          type: 'run.waiting',
          runId: SUITE_STEP,
          wait: {
            delegations: [`${SUITE}-integration`],
            since: NOW - 8 * MINUTE,
            reason: 'Its turn ended while delegated work runs.',
          },
        }),
      ],
    },
  ];
}

const notice = (event: 'started' | 'reported', runIds: string[]): ChatEvent => ({
  type: 'notice',
  notice: { kind: 'delegation', event, runIds },
});

function delegateCall(delegate: Delegate): ChatEvent[] {
  return [
    callTool(`delegate-${delegate.id}`, {
      kind: 'shinsa',
      name: 'delegate_task',
      args: {
        brief: delegate.brief,
        title: delegate.title,
        role: delegate.role,
        isolation: delegate.isolation,
      },
    }),
    resolveToolOutput(
      `delegate-${delegate.id}`,
      JSON.stringify({ delegation_id: delegate.id, status: 'queued' })
    ),
    notice('started', [delegate.id]),
  ];
}

function findDelegate(id: string) {
  const delegate = DELEGATES.find((candidate) => candidate.id === id);
  if (!delegate) throw new Error(`No seeded delegate ${id}`);
  return delegate;
}

function brief(delegate: Delegate): ChatEvent {
  return {
    type: 'user',
    from: 'shinsa',
    text: `Another agent delegated one piece of its work to you.\nYour role: ${delegate.role}.\n\nThe brief:\n${delegate.brief}`,
    attachments: [],
  };
}

function writeRetryStep(dir: string) {
  const review = findDelegate(`${RETRY}-review`);
  const callers = findDelegate(`${RETRY}-callers`);
  const streaming = findDelegate(`${RETRY}-streaming`);
  const report = resolveDeliveryPrompt(
    {
      results: [
        {
          runId: review.id,
          title: review.title,
          role: 'reviewer',
          status: 'completed',
          result: REVIEW_RESULT,
        },
      ],
      questions: [],
      messages: [],
    },
    RETRY_BUILDER
  );
  writeTranscript(dir, RETRY_STEP, [
    ...spreadEvents(
      [
        { type: 'status', status: 'started', outcome: null },
        {
          type: 'user',
          from: 'shinsa',
          text: 'You are the builder for phase 1: wrap the chunk write in a retry.',
          attachments: [],
        },
        say('I will wrap the write first, and ask a reviewer to check which errors deserve a retry.'),
        callTool('read-1', { kind: 'read', path: 'src/export/clickhouse.ts', range: { start: 1, end: 40 } }),
        resolveToolOutput('read-1', '1\texport async function runExport(app: App) {'),
        ...delegateCall(review),
      ],
      NOW - 24 * MINUTE,
      NOW - 22 * MINUTE
    ),
    ...spreadEvents(
      [
        { type: 'user', from: 'shinsa', text: report, attachments: [] },
        notice('reported', [review.id]),
        say('The review is right about 400s. I will retry only timeouts and 5xx, with doubling backoff.'),
        ...delegateCall(callers),
      ],
      NOW - 15 * MINUTE,
      NOW - 14 * MINUTE
    ),
    ...spreadEvents(
      [
        ...delegateCall(streaming),
        callTool('status-1', {
          kind: 'shinsa',
          name: 'delegation_status',
          args: { delegation_id: callers.id },
        }),
        resolveToolOutput(
          'status-1',
          JSON.stringify({
            delegation_id: callers.id,
            status: 'running',
            has_pending_question: false,
            result: null,
          })
        ),
        callTool('edit-1', {
          kind: 'edit',
          path: 'src/export/clickhouse.ts',
          hunks: [
            { before: 'await writeChunk(chunk);', after: 'await retryTransient(() => writeChunk(chunk));' },
          ],
        }),
        resolveToolOutput('edit-1', 'The file has been updated.'),
        callTool('test-1', {
          kind: 'command',
          action: 'run',
          command: 'bun test src/export',
          description: 'Run the export tests',
        }),
      ],
      NOW - 12 * MINUTE,
      NOW - 2 * MINUTE
    ),
  ]);
}

function writeDelegates(dir: string) {
  writeTranscript(
    dir,
    `${RETRY}-review`,
    spreadEvents(
      [
        brief(findDelegate(`${RETRY}-review`)),
        callTool('r-1', { kind: 'read', path: 'src/export/clickhouse.ts', range: null }),
        resolveToolOutput('r-1', 'export async function runExport(app: App) {'),
        callTool('r-2', { kind: 'search', mode: 'content', query: 'retry', path: 'src/export' }),
        resolveToolOutput('r-2', 'src/export/chunks.ts:18'),
        say(REVIEW_RESULT, 'final'),
        { type: 'status', status: 'ended', outcome: 'completed' },
      ],
      NOW - 22 * MINUTE,
      NOW - 15 * MINUTE
    )
  );
  writeTranscript(
    dir,
    `${RETRY}-callers`,
    spreadEvents(
      [
        brief(findDelegate(`${RETRY}-callers`)),
        callTool('c-1', { kind: 'search', mode: 'content', query: 'runExport(', path: 'src' }),
        resolveToolOutput('c-1', 'src/jobs/nightly.ts:12\nsrc/admin/export-button.ts:30'),
        ...delegateCall(findDelegate(`${RETRY}-timeouts`)),
        say('Two callers can overlap for the same app. That is a decision for the agent that sent me.'),
        callTool('ask-1', {
          kind: 'shinsa',
          name: 'ask',
          args: { question: QUESTION.question, context: QUESTION.context },
        }),
        { type: 'status', status: 'waiting', outcome: null },
      ],
      NOW - 14 * MINUTE,
      NOW - 4 * MINUTE
    )
  );
  writeTranscript(
    dir,
    `${RETRY}-timeouts`,
    spreadEvents(
      [
        brief(findDelegate(`${RETRY}-timeouts`)),
        say('Reading the ClickHouse client config.'),
        callTool('t-1', { kind: 'read', path: 'src/clickhouse/client.ts', range: null }),
      ],
      NOW - 9 * MINUTE,
      NOW - 3 * MINUTE
    )
  );
  writeTranscript(
    dir,
    `${RETRY}-streaming`,
    spreadEvents(
      [
        brief(findDelegate(`${RETRY}-streaming`)),
        callTool('s-1', { kind: 'read', path: 'src/export/chunks.ts', range: null }),
        resolveToolOutput('s-1', 'export function planChunks(app: App) {'),
        { type: 'status', status: 'ended', outcome: 'cancelled' },
      ],
      NOW - 12 * MINUTE,
      NOW - 6 * MINUTE
    )
  );
  const suite = findDelegate(`${SUITE}-integration`);
  writeTranscript(
    dir,
    suite.id,
    spreadEvents(
      [
        brief(suite),
        callTool('i-1', {
          kind: 'command',
          action: 'run',
          command: 'bun test:integration',
          description: 'Run the integration suite',
        }),
      ],
      NOW - 11 * MINUTE,
      NOW - 1 * MINUTE
    )
  );
  writeTranscript(
    dir,
    SUITE_STEP,
    spreadEvents(
      [
        { type: 'status', status: 'started', outcome: null },
        {
          type: 'user',
          from: 'shinsa',
          text: 'You are the builder for phase 1: move the export tests onto the shared fixture.',
          attachments: [],
        },
        callTool('e-1', {
          kind: 'edit',
          path: 'test/export/setup.ts',
          hunks: [{ before: 'createClickHouse()', after: 'useSharedClickHouse()' }],
        }),
        resolveToolOutput('e-1', 'The file has been updated.'),
        ...delegateCall(suite),
        say('The integration suite takes about twenty minutes. I will end my turn; its result wakes me.'),
      ],
      NOW - 12 * MINUTE,
      NOW - 8 * MINUTE
    )
  );
}

export function writeDelegationTranscripts(dir: string) {
  writeRetryStep(dir);
  writeDelegates(dir);
}
