import type { AutopilotLesson, ShinsaEventInput } from '../../packages/core/src/index.ts';
import { HOUR } from '../kit/time.ts';
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
