import type { Gate, GateDecision, Task } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveAutopilotFacts } from './limits.ts';
import {
  AUTOPILOT_LESSON_LIMITS,
  type AutopilotGateKind,
  type AutopilotLesson,
  type AutopilotLessonAnswer,
  type AutopilotLessonFacts,
  type AutopilotLessonKind,
  type AutopilotLimit,
} from './schema.ts';

export type AutopilotLessonsState = Pick<ShinsaState, 'autopilotLessons'>;

const LESSON_GATES: readonly AutopilotGateKind[] = [
  'plan',
  'question',
  'review',
  'merge',
  'proposal',
  'failure',
];

const DECIDED_GATES: ReadonlySet<Gate['type']> = new Set<Gate['type']>(['plan', 'review', 'merge']);

const CORRECTS: Partial<Record<Gate['type'], ReadonlySet<Gate['type']>>> = {
  merge: new Set<Gate['type']>(['review']),
};

const ANSWER: Record<GateDecision, AutopilotLessonAnswer> = {
  approve: 'approved',
  revise: 'revised',
  reject: 'rejected',
  reply: 'replied',
};

const GATE_NOUN: Record<AutopilotGateKind, string> = {
  plan: 'plans',
  question: 'agents’ questions',
  review: 'reviews',
  merge: 'merges',
  proposal: 'agents’ proposals',
  failure: 'failed steps',
};

const ACTED_TEXT: Record<AutopilotGateKind, string> = {
  plan: 'You approved a plan for them',
  question: 'You answered an agent’s question for them',
  review: 'You approved a review for them',
  merge: 'You merged a change for them',
  proposal: 'You gave your OK on an agent’s proposal for them',
  failure: 'You handled a failed step for them',
};

const FORWARDED_TEXT: Record<AutopilotGateKind, string> = {
  plan: 'You brought a plan to them',
  question: 'You brought an agent’s question to them',
  review: 'You brought a review to them',
  merge: 'You brought a merge to them',
  proposal: 'You brought an agent’s proposal to them',
  failure: 'You brought a failed step to them',
};

const ACTED_ANSWER_TEXT: Record<AutopilotLessonAnswer, string> = {
  approved: 'they went along with it',
  revised: 'they asked for changes later',
  rejected: 'they rejected the task later',
  replied: 'they replied later',
};

const FORWARDED_ANSWER_TEXT: Record<AutopilotLessonAnswer, string> = {
  approved: 'they approved it as it was, so you could have acted',
  revised: 'they asked for changes',
  rejected: 'they rejected it',
  replied: 'they answered',
};

function isGateKind(type: Gate['type']): type is AutopilotGateKind {
  return (LESSON_GATES as readonly string[]).includes(type);
}

function clipNote(response: string | null) {
  const note = (response ?? '').trim();
  if (!note) return null;
  const limit = AUTOPILOT_LESSON_LIMITS.note;
  return note.length > limit ? `${note.slice(0, limit - 1)}…` : note;
}

function resolveLessonFacts(
  state: ShinsaState,
  task: Task,
  gate: AutopilotGateKind,
  now: number
): AutopilotLessonFacts {
  const facts = resolveAutopilotFacts(state, task, gate, now, now);
  return {
    urgent: facts.urgent,
    watchdog: facts.watchdog,
    confidence: facts.confidence,
    risk: facts.risk,
    scope: facts.scope,
  };
}

function isCorrection(lesson: AutopilotLesson) {
  return lesson.kind === 'acted' && (lesson.answer === 'revised' || lesson.answer === 'rejected');
}

interface LessonDraft {
  gate: Gate;
  kind: AutopilotLessonKind;
  reason: string;
}

function isJudgedBy(gate: Gate, answered: Gate, decision: GateDecision) {
  if (decision === 'approve') return true;
  return CORRECTS[answered.type]?.has(gate.type) === true;
}

function listActedGates(state: ShinsaState, answered: Gate, decision: GateDecision): LessonDraft[] {
  if (!DECIDED_GATES.has(answered.type)) return [];
  return Object.values(state.gates)
    .filter(
      (gate) =>
        gate.taskId === answered.taskId &&
        gate.id !== answered.id &&
        gate.autopilotAnswer !== undefined &&
        gate.autopilotLearned !== true &&
        isGateKind(gate.type) &&
        isJudgedBy(gate, answered, decision)
    )
    .map((gate) => ({ gate, kind: 'acted' as const, reason: gate.autopilotAnswer ?? '' }));
}

function listForwardedGate(answered: Gate): LessonDraft[] {
  if (answered.autopilotHeld === undefined || answered.autopilotTeaches !== true) return [];
  if (!isGateKind(answered.type)) return [];
  return [{ gate: answered, kind: 'forwarded', reason: answered.autopilotHeld }];
}

export interface LessonAnswer {
  gate: Gate;
  decision: GateDecision;
  response: string | null;
}

export function listAutopilotLessonsToLearn(
  state: ShinsaState,
  answer: LessonAnswer,
  now: number,
  newId: () => string
): AutopilotLesson[] {
  const task = state.tasks[answer.gate.taskId];
  if (!task) return [];
  const note = clipNote(answer.response);
  return [...listActedGates(state, answer.gate, answer.decision), ...listForwardedGate(answer.gate)].flatMap(
    (draft) => {
      const gate = draft.gate.type;
      if (!isGateKind(gate)) return [];
      return [
        {
          id: newId(),
          at: now,
          taskId: task.id,
          gateId: draft.gate.id,
          gate,
          kind: draft.kind,
          answer: ANSWER[answer.decision],
          reason: draft.reason,
          note,
          facts: resolveLessonFacts(state, task, gate, now),
        },
      ];
    }
  );
}

export function listAutopilotLessons(state: AutopilotLessonsState, gate?: AutopilotGateKind) {
  const lessons = state.autopilotLessons ?? [];
  return [...lessons].reverse().filter((lesson) => gate === undefined || lesson.gate === gate);
}

function isPaused(lessons: readonly AutopilotLesson[]) {
  const window = lessons.slice(0, AUTOPILOT_LESSON_LIMITS.window);
  return window.filter(isCorrection).length >= AUTOPILOT_LESSON_LIMITS.corrections;
}

export function resolveLessonLimit(state: AutopilotLessonsState, gate: AutopilotGateKind): AutopilotLimit {
  if (!isPaused(listAutopilotLessons(state, gate))) return { allowed: true };
  return {
    allowed: false,
    setting: false,
    reason: `You changed what Autopilot did at your last few ${GATE_NOUN[gate]}, so it brings them to you for now.`,
  };
}

function describeFacts(facts: AutopilotLessonFacts) {
  const parts = [
    facts.risk ? `risk ${facts.risk}` : null,
    facts.confidence ? `confidence ${facts.confidence}` : null,
    facts.scope ? `${facts.scope.phases} phases, ${facts.scope.files} files` : null,
    facts.urgent ? 'urgent' : null,
    facts.watchdog ? 'filed by a watchdog' : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

export function describeAutopilotLesson(lesson: AutopilotLesson) {
  const did = lesson.kind === 'acted' ? ACTED_TEXT[lesson.gate] : FORWARDED_TEXT[lesson.gate];
  const answer = (lesson.kind === 'acted' ? ACTED_ANSWER_TEXT : FORWARDED_ANSWER_TEXT)[lesson.answer];
  const note = lesson.note ? `: “${lesson.note}”` : '';
  return `${did}${describeFacts(lesson.facts)}; ${answer}${note}.`;
}

export function listAutopilotLessonLines(state: AutopilotLessonsState, gate: AutopilotGateKind) {
  return listAutopilotLessons(state, gate)
    .slice(0, AUTOPILOT_LESSON_LIMITS.prompt)
    .map((lesson) => `- ${describeAutopilotLesson(lesson)}`);
}
