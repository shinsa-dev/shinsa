import { listAutopilotLessonsToLearn, type LessonAnswer } from '../autopilot/lessons.ts';
import { createAutopilotDecision, type DecisionDraft, listGateDecisionDrafts } from '../autopilot/profile.ts';
import type { FindingVerdict } from '../domain/schema.ts';
import type { Decider } from './decider.ts';

function isYours(decider: Decider) {
  return !decider.context.guest && !decider.context.onBehalf;
}

export function recordDecisions(decider: Decider, drafts: readonly DecisionDraft[]) {
  if (!isYours(decider) || drafts.length === 0) return;
  decider.emit({
    type: 'autopilot.decided',
    decisions: drafts.map((draft) => createAutopilotDecision(draft, decider.context.now)),
  });
}

export function learnFromAnswer(
  decider: Decider,
  answer: LessonAnswer & { verdicts?: readonly FindingVerdict[] }
) {
  if (decider.context.guest) return;
  const task = decider.task(answer.gate.taskId);
  recordDecisions(decider, listGateDecisionDrafts(task, answer));
  const lessons = listAutopilotLessonsToLearn(
    decider.state,
    answer,
    decider.context.now,
    decider.context.newId
  );
  if (lessons.length > 0) decider.emit({ type: 'autopilot.learned', lessons });
}
