import type { Initiative, ShinsaEventInput } from '../../packages/core/src/index.ts';
import { HOUR, MINUTE } from '../kit/time.ts';
import { CHOSEN_BY_YOU, NO_TRIAGE_DECISIONS, NOW } from './kit.ts';
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

export const SEED_INITIATIVE_ID = 'initiative-chat-split';

export const SEED_LEAD_ID = 'task-chat-split-lead';

const LEAD_NARRATIVE = [
  'The session is nearly done: the embedded chat is in review and the stream tools are being built. Webhook signing shipped on Tuesday.',
  '',
  'Tools in the chat start once the session merges. I put tool retries after tool progress, so the retry can reuse its events, and dropped the old banner from editing: the new dock replaces it.',
].join('\n');

const LEAD_QUESTIONS = [
  'Should editing a paywall from the chat wait for the tool summary, or start beside it?',
  'The docs gate has waited two days for its plan. Is it still wanted in this initiative?',
];

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
    request:
      'Lead the initiative “Chat split”: keep its tasks moving, file and order the next pieces, and report where it stands.',
    repoId: null,
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
    pipeline: ['lead'],
    decisions: NO_TRIAGE_DECISIONS,
  });
  push(started + 2 * MINUTE, {
    type: 'task.staged',
    taskId: SEED_LEAD_ID,
    stage: 'leading',
    reason: 'leading the initiative',
  });
  const at = NOW - 25 * MINUTE;
  push(at, {
    type: 'initiative.reported',
    initiativeId: SEED_INITIATIVE_ID,
    report: { narrative: LEAD_NARRATIVE, questions: LEAD_QUESTIONS, runId: `${SEED_LEAD_ID}-run`, at },
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
