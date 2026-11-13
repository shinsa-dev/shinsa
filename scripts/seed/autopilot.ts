import type { AutopilotLesson, Gate, ShinsaEventInput } from '../../packages/core/src/index.ts';
import { HOUR, MINUTE } from '../kit/time.ts';
import { NOW } from './kit.ts';

const LOW_RISK = { urgent: false, watchdog: false, confidence: 'high', risk: 'low', scope: null } as const;

function createSeedLesson(
  id: string,
  hoursAgo: number,
  lesson: Pick<AutopilotLesson, 'gate' | 'kind' | 'answer'> & Partial<AutopilotLesson>
): AutopilotLesson {
  return {
    id: `lesson-${id}`,
    at: NOW - hoursAgo * HOUR,
    taskId: 'seed-autopilot',
    gateId: `seed-autopilot-gate-${id}`,
    reason: 'Clear, small and low risk.',
    note: null,
    facts: LOW_RISK,
    ...lesson,
  };
}

export function pushSeedAutopilotLessons(push: (at: number, event: ShinsaEventInput) => void) {
  const lessons = [
    createSeedLesson('plan-1', 30, { gate: 'plan', kind: 'acted', answer: 'approved' }),
    createSeedLesson('plan-2', 20, { gate: 'plan', kind: 'acted', answer: 'approved' }),
    createSeedLesson('plan-3', 12, { gate: 'plan', kind: 'forwarded', answer: 'approved' }),
    createSeedLesson('review-1', 26, { gate: 'review', kind: 'acted', answer: 'approved' }),
    createSeedLesson('review-2', 8, {
      gate: 'review',
      kind: 'acted',
      answer: 'revised',
      note: 'Keep the old route.',
    }),
    createSeedLesson('review-3', 4, { gate: 'review', kind: 'acted', answer: 'revised' }),
    createSeedLesson('merge-1', 6, { gate: 'merge', kind: 'acted', answer: 'approved' }),
  ];
  for (const lesson of lessons) push(lesson.at, { type: 'autopilot.learned', lessons: [lesson] });
}

interface SeedHandled {
  taskId: string;
  type: Extract<Gate['type'], 'plan' | 'question' | 'merge'>;
  title: string;
  hoursAgo: number;
  reason: string;
  response: string | null;
}

const SEED_HANDLED: readonly SeedHandled[] = [
  {
    taskId: 'task-docs-gate',
    type: 'merge',
    title: 'Merge “Remove the access gate from the framework docs”',
    hoursAgo: 1.5,
    reason: 'A one-file docs change, rated high confidence and low risk, with every check green.',
    response: null,
  },
  {
    taskId: 'task-export-retry',
    type: 'plan',
    title: 'Approve the plan for “Retry ClickHouse exports that time out”',
    hoursAgo: 3,
    reason: 'Two small phases in one package, with a test for the retry.',
    response: null,
  },
  {
    taskId: 'task-stream-tools',
    type: 'question',
    title: 'Should the stream keep the old event names?',
    hoursAgo: 0.6,
    reason: 'You kept old names in your last three answers like this.',
    response: 'Keep the old event names, and add the new ones beside them.',
  },
];

export function pushSeedAutopilotHandled(push: (at: number, event: ShinsaEventInput) => void) {
  for (const handled of SEED_HANDLED) {
    const at = NOW - handled.hoursAgo * HOUR;
    const gateId = `${handled.taskId}-autopilot-${handled.type}`;
    push(at, {
      type: 'gate.opened',
      gate: {
        id: gateId,
        taskId: handled.taskId,
        type: handled.type,
        status: 'open',
        title: handled.title,
        body: handled.reason,
        runId: null,
        openedAt: at,
        answeredAt: null,
        decision: null,
        response: null,
      },
    });
    push(at + MINUTE, {
      type: 'gate.answered',
      gateId,
      decision: handled.type === 'question' ? 'reply' : 'approve',
      response: handled.response,
      autopilot: handled.reason,
    });
  }
}
