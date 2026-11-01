import type { Feedback } from '../domain/feedback.ts';

export type FeedbackEventBody =
  | { type: 'feedback.recorded'; entry: Feedback }
  | { type: 'feedback.removed'; feedbackId: string };
