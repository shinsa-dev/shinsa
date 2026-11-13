import type {
  AutopilotDecision,
  AutopilotDecisionAnswer,
  AutopilotDecisionFacts,
  AutopilotDecisionKind,
  AutopilotLesson,
  AutopilotVerdict,
  Gate,
  ShinsaEventInput,
} from '../../packages/core/src/index.ts';
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

const SEED_DECISION_PROJECTS = ['project-superwall', 'project-basket', 'project-personal'] as const;

const SEED_DECISION_KINDS: readonly AutopilotDecisionKind[] = [
  'review',
  'plan',
  'merge',
  'review',
  'finding',
  'plan',
  'suggestion',
  'question',
];

const SEED_DISAGREEMENTS = new Set([9, 26, 41, 58]);

const SEED_NOTES: Readonly<Record<number, string>> = {
  9: 'Keep the old route until the mobile app ships.',
  26: 'Split the migration into its own task.',
  41: 'Too broad for one pull request.',
};

function resolveSeedAnswer(kind: AutopilotDecisionKind, index: number): AutopilotDecisionAnswer {
  if (kind === 'finding') return index % 3 === 0 ? 'dismissed' : 'fixed';
  if (kind === 'suggestion') return index % 2 === 0 ? 'accepted' : 'dismissed';
  if (kind === 'question') return 'replied';
  if (SEED_DISAGREEMENTS.has(index)) return 'revised';
  return index % 9 === 0 ? 'revised' : 'approved';
}

function resolveSeedGuess(kind: AutopilotDecisionKind, answer: AutopilotDecisionAnswer, index: number) {
  if (kind !== 'plan' && kind !== 'review' && kind !== 'merge') return null;
  const agreeing: AutopilotVerdict = answer === 'approved' ? 'act' : 'forward';
  if (!SEED_DISAGREEMENTS.has(index)) return agreeing;
  return agreeing === 'act' ? 'forward' : 'act';
}

const SEED_MODEL_DOUBTS: Readonly<Record<number, number>> = { 41: 0.35, 48: 0.4 };

function createSeedEstimate(kind: AutopilotDecisionKind, answer: AutopilotDecisionAnswer, index: number) {
  const guess = resolveSeedGuess(kind, answer, index);
  if (guess === null) return null;
  return {
    head: 'gate' as const,
    p: SEED_MODEL_DOUBTS[index] ?? (guess === 'act' ? 0.82 : 0.3),
    confidence: index >= 30 ? 0.7 : 0.2,
    similar: Math.min(index, 40),
  };
}

function createSeedFacts(answer: AutopilotDecisionAnswer, index: number): AutopilotDecisionFacts {
  const pushedBack = answer === 'revised' || answer === 'rejected';
  return {
    confidence: pushedBack ? 'medium' : 'high',
    shape: 'change',
    repoId: `repo-${SEED_DECISION_PROJECTS[index % SEED_DECISION_PROJECTS.length] ?? 'none'}`,
    revisions: pushedBack ? 1 : 0,
    findings: { blocking: pushedBack ? 1 : 0, shouldFix: index % 4 === 0 ? 1 : 0, optional: index % 3 },
    heldPlan: false,
    waitedMinutes: 5 + ((index * 7) % 240),
    active: index % 6 !== 0,
    inHours: index % 6 !== 0,
    hour: (9 + index) % 24,
  };
}

function createSeedDecision(index: number): AutopilotDecision {
  const kind = SEED_DECISION_KINDS[index % SEED_DECISION_KINDS.length] ?? 'review';
  const answer = resolveSeedAnswer(kind, index);
  return {
    at: NOW - (9 * 24 - index * 2) * HOUR,
    taskId: 'seed-autopilot',
    gateId: kind === 'finding' || kind === 'suggestion' ? null : `seed-decision-${index}`,
    kind,
    answer,
    projectId: SEED_DECISION_PROJECTS[index % SEED_DECISION_PROJECTS.length] ?? null,
    risk: index % 5 === 0 ? 'medium' : 'low',
    scope: kind === 'plan' ? { phases: 2 + (index % 3), files: 3 + (index % 5) } : null,
    urgent: false,
    watchdog: index % 11 === 0,
    touched: index % 4 === 0,
    guess: resolveSeedGuess(kind, answer, index),
    note: SEED_NOTES[index] ?? null,
    facts: createSeedFacts(answer, index),
    estimate: createSeedEstimate(kind, answer, index),
  };
}

export function pushSeedAutopilotDecisions(push: (at: number, event: ShinsaEventInput) => void) {
  for (let index = 0; index < 90; index += 1) {
    const decision = createSeedDecision(index);
    push(decision.at, { type: 'autopilot.decided', decisions: [decision] });
  }
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
