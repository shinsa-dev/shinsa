import { listAutopilotLessonsToLearn, type LessonAnswer } from '../autopilot/lessons.ts';
import { createAutopilotDecision, type DecisionDraft, listGateDecisionDrafts } from '../autopilot/profile.ts';
import { TASK_PRIORITIES, type TaskPriority } from '../domain/index.ts';
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

export function learnFromMessage(decider: Decider, taskId: string, text: string) {
  recordDecisions(decider, [
    { task: decider.task(taskId), gate: null, kind: 'message', answer: 'sent', note: text },
  ]);
}

export function learnFromPriority(decider: Decider, taskId: string, from: TaskPriority, to: TaskPriority) {
  const raised = TASK_PRIORITIES.indexOf(to) < TASK_PRIORITIES.indexOf(from);
  recordDecisions(decider, [
    {
      task: decider.task(taskId),
      gate: null,
      kind: 'priority',
      answer: raised ? 'raised' : 'lowered',
      note: to,
    },
  ]);
}

export function learnFromCancel(decider: Decider, taskId: string) {
  recordDecisions(decider, [
    { task: decider.task(taskId), gate: null, kind: 'cancel', answer: 'cancelled', note: null },
  ]);
}
