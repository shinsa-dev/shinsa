import type { SlackMention } from '../slack/contract.ts';
import type { SlackEvaluation } from '../slack/evaluation.ts';

export type SlackSystemCommand =
  | { type: 'slack.mention'; mention: SlackMention }
  | {
      type: 'slack.record_evaluation';
      mention: SlackMention;
      statusTs: string | null;
      evaluation: SlackEvaluation;
    }
  | { type: 'slack.record_status'; taskId: string; ts: string };
