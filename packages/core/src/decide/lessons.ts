import { listAutopilotLessonsToLearn, type LessonAnswer } from '../autopilot/lessons.ts';
import type { Decider } from './decider.ts';

export function learnFromAnswer(decider: Decider, answer: LessonAnswer) {
  if (decider.context.guest) return;
  const lessons = listAutopilotLessonsToLearn(
    decider.state,
    answer,
    decider.context.now,
    decider.context.newId
  );
  if (lessons.length > 0) decider.emit({ type: 'autopilot.learned', lessons });
}
