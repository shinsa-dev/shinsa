import type { ChatEvent, Initiative, PlanDocument, ShinsaEventInput } from '../../packages/core/src/index.ts';
import { HOUR, MINUTE } from '../kit/time.ts';
import {
  CHOSEN_BY_YOU,
  callTool,
  NO_TRIAGE_DECISIONS,
  NOW,
  resolveToolOutput,
  type SeedTranscript,
  say,
  spreadEvents,
} from './kit.ts';
import type { Timeline } from './timeline.ts';

const PHASES = [
  { id: 'phase-chat-session', name: 'Session and transport' },
  { id: 'phase-chat-tools', name: 'Tools in the chat' },
  { id: 'phase-chat-editing', name: 'Editing from the chat' },
];

const [SESSION, TOOLS, EDITING] = PHASES.map((phase) => phase.id) as [string, string, string];

const MEMBERS: Record<string, string> = {
  'task-docs-gate': SESSION,
  'task-webhook-signing': SESSION,
  'task-embedded-chat': SESSION,
  'task-stream-tools': SESSION,
  'task-chat-tools': TOOLS,
  'task-tool-progress': TOOLS,
  'task-tool-retry': TOOLS,
  'task-tool-summary': TOOLS,
  'task-chat-paywall-editing': EDITING,
  'task-old-banner': EDITING,
};

const SEED_INITIATIVE_ID = 'initiative-chat-split';

const SEED_LEAD_ID = 'task-chat-split-lead';

const SEED_LEAD_RUN = `${SEED_LEAD_ID}-run`;

const LEAD_REQUEST =
  'Lead the initiative “Chat split”: keep its tasks moving, file and order the next pieces, and report where it stands.';

const LEAD_TURN_START = NOW - 32 * MINUTE;

const LEAD_TURN_END = NOW - 25 * MINUTE;

const LEAD_NARRATIVE = [
  'The session is nearly done: the embedded chat is in review and the stream tools are being built. Webhook signing is being planned, and the embedded chat on MCP v2 waits on it.',
  '',
  'Tools in the chat start once the session merges. The tool summary waits on both progress and retries, since it reports what each did, and I dropped the old banner from editing: the new dock replaces it.',
].join('\n');

const LEAD_PLAN: PlanDocument = {
  goal: 'Move the embedded chat onto MCP v2 and ship it as small pull requests, each merged on its own.',
  phases: [
    { title: 'Session and transport', detail: 'The embedded chat runs on MCP v2 with signed webhooks.' },
    { title: 'Tools in the chat', detail: 'Tool calls stream, show their progress, retry and summarise.' },
    { title: 'Editing from the chat', detail: 'A paywall can be edited from the chat.' },
  ],
  behaviour: [],
  approach:
    'The session lands first, since every tool needs it. The tools split into four small pieces in embedded, and editing comes last, in pwn.',
  files: [],
  outOfScope: ['The old editor banner: the new dock replaces it.'],
  verification: [],
  questions: [],
  split: [
    {
      title: 'Run the embedded chat on MCP v2',
      request: 'In embedded, move the chat onto MCP v2.',
      order: 'parallel',
      phase: 1,
    },
    {
      title: 'Sign outgoing webhooks',
      request: 'In superwall, sign the webhooks the chat sends.',
      order: 'parallel',
      phase: 1,
    },
    {
      title: 'Stream MCP tool results',
      request: 'In embedded, stream tool results into the chat.',
      order: 'waits_on',
      on: 1,
      phase: 2,
    },
    {
      title: 'Edit a paywall from the chat',
      request: 'In pwn, let the chat edit a paywall.',
      order: 'waits_on',
      on: 3,
      phase: 3,
    },
  ],
};

function createSeedInitiative(at: number): Initiative {
  return {
    id: SEED_INITIATIVE_ID,
    name: 'Chat split',
    description:
      'Move the embedded chat onto MCP v2 and ship it as small pull requests: the session first, then tools in the chat, then editing a paywall from it.',
    phases: PHASES.map((phase) => ({ ...phase })),
    leadTaskId: SEED_LEAD_ID,
    createdAt: at,
    updatedAt: at,
  };
}

function pushSeedLead(push: (at: number, event: ShinsaEventInput) => void) {
  const started = NOW - 3 * HOUR;
  push(started, {
    type: 'task.created',
    taskId: SEED_LEAD_ID,
    request: LEAD_REQUEST,
    repoId: null,
    projectId: 'project-superwall',
    priority: 'normal',
    planFirst: false,
    origin: null,
    shape: 'lead',
    auto: CHOSEN_BY_YOU,
  });
  push(started + MINUTE, {
    type: 'task.triaged',
    taskId: SEED_LEAD_ID,
    title: 'Lead the chat split',
    repoId: null,
    size: 'small',
    branch: 'lead/chat-split',
    pipeline: ['plan', 'lead'],
    decisions: NO_TRIAGE_DECISIONS,
  });
  push(started + 2 * MINUTE, {
    type: 'task.staged',
    taskId: SEED_LEAD_ID,
    stage: 'planning',
    reason: 'planning the initiative',
  });
  push(started + 8 * MINUTE, {
    type: 'plan.proposed',
    taskId: SEED_LEAD_ID,
    body: LEAD_PLAN.goal,
    document: LEAD_PLAN,
  });
  push(started + 20 * MINUTE, { type: 'plan.approved', taskId: SEED_LEAD_ID, version: 1 });
  push(started + 20 * MINUTE, {
    type: 'task.staged',
    taskId: SEED_LEAD_ID,
    stage: 'leading',
    reason: 'leading the initiative',
  });
  push(LEAD_TURN_START, {
    type: 'run.started',
    run: {
      id: SEED_LEAD_RUN,
      taskId: SEED_LEAD_ID,
      role: 'agent',
      purpose: 'lead',
      provider: 'claude',
      model: 'claude-opus-5-5',
      sessionId: null,
      startedAt: LEAD_TURN_START,
      endedAt: null,
      outcome: null,
      summary: null,
    },
  });
  push(LEAD_TURN_END, {
    type: 'initiative.reported',
    initiativeId: SEED_INITIATIVE_ID,
    report: { narrative: LEAD_NARRATIVE, runId: SEED_LEAD_RUN, at: LEAD_TURN_END },
  });
  push(LEAD_TURN_END, {
    type: 'run.ended',
    runId: SEED_LEAD_RUN,
    outcome: 'completed',
    summary: 'Reported where the chat split stands.',
  });
}

export function pushSeedInitiative(start: number, push: (at: number, event: ShinsaEventInput) => void) {
  push(start, { type: 'initiative.written', initiative: createSeedInitiative(start) });
  pushSeedLead(push);
}

export function applySeedInitiative(timeline: Timeline): Timeline {
  return timeline.map(({ at, event }) => {
    if (event.type !== 'task.created') return { at, event };
    if (event.taskId === SEED_LEAD_ID) return { at, event: { ...event, initiativeId: SEED_INITIATIVE_ID } };
    const phaseId = MEMBERS[event.taskId];
    if (!phaseId) return { at, event };
    return { at, event: { ...event, initiativeId: SEED_INITIATIVE_ID, initiativePhaseId: phaseId } };
  });
}

const LEAD_TURN: ChatEvent[] = [
  { type: 'status', status: 'started', outcome: null },
  {
    type: 'user',
    from: 'shinsa',
    text: `${LEAD_REQUEST}\n\nWhat changed since your last turn:\n- SW-28 Run the embedded chat on MCP v2: review opened\n- SW-67 Stream MCP tool results: plan approved\n- SW-19 Banner for the old editor: cancelled`,
    attachments: [],
  },
  say(
    'Three of the session’s tasks moved. I’ll read the embedded chat’s review and where the tool tasks wait.'
  ),
  callTool('lead-read', { kind: 'shinsa', name: 'read_task', args: { task_id: 'SW-28' } }),
  resolveToolOutput('lead-read', 'SW-28 · changes to review · pull request open, checks passing'),
  callTool('lead-list', { kind: 'mcp', server: 'shinsa', name: 'tasks_list', args: { query: 'chat tool' } }),
  resolveToolOutput(
    'lead-list',
    'SW-71 Show tool progress in the chat · waiting on SW-67\nSW-72 Retry failed tool calls in the chat · waiting on SW-67\nSW-73 Summarise tool runs at the end of a chat · waiting on SW-71'
  ),
  say('The summary reports what retries did too, so SW-73 should wait for SW-72 as well.'),
  callTool('lead-wait', {
    kind: 'mcp',
    server: 'shinsa',
    name: 'tasks_wait_on',
    args: { task: 'SW-73', waits_on: ['SW-71', 'SW-72'] },
  }),
  resolveToolOutput('lead-wait', 'SW-73 now waits on SW-71 and SW-72.'),
  callTool('lead-report', {
    kind: 'shinsa',
    name: 'report_initiative',
    args: { narrative: LEAD_NARRATIVE },
  }),
  resolveToolOutput('lead-report', 'Reported.'),
  { type: 'status', status: 'ended', outcome: 'completed' },
];

export function listLeadTranscripts(): SeedTranscript[] {
  return [{ runId: SEED_LEAD_RUN, timed: spreadEvents(LEAD_TURN, LEAD_TURN_START, LEAD_TURN_END) }];
}
