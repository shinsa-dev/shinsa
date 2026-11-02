export type FeedbackAgentCommand = { type: 'agent.report_feedback'; runId: string; note: string };

export type FeedbackSystemCommand =
  | { type: 'feedback.record_draft'; feedbackId: string; title: string; body: string }
  | { type: 'feedback.record_filed'; feedbackId: string; number: number; url: string }
  | { type: 'feedback.record_issue_state'; feedbackId: string; closedAt: number | null }
  | { type: 'feedback.record_failure'; feedbackId: string; detail: string };
