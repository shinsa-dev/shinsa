import type { Initiative, ShinsaEventInput } from '../../packages/core/src/index.ts';
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

function createSeedInitiative(at: number): Initiative {
  return {
    id: SEED_INITIATIVE_ID,
    name: 'Chat split',
    description:
      'Move the embedded chat onto MCP v2 and ship it as small pull requests: the session first, then tools in the chat, then editing a paywall from it.',
    phases: PHASES.map((phase) => ({ ...phase })),
    leadTaskId: null,
    createdAt: at,
    updatedAt: at,
  };
}

export function pushSeedInitiative(start: number, push: (at: number, event: ShinsaEventInput) => void) {
  push(start, { type: 'initiative.written', initiative: createSeedInitiative(start) });
}

export function applySeedInitiative(timeline: Timeline): Timeline {
  return timeline.map(({ at, event }) => {
    if (event.type !== 'task.created') return { at, event };
    const phaseId = MEMBERS[event.taskId];
    if (!phaseId) return { at, event };
    return { at, event: { ...event, initiativeId: SEED_INITIATIVE_ID, initiativePhaseId: phaseId } };
  });
}
