import type { AutopilotContact } from '../domain/settings.ts';
import type { SlackDecision, SlackMention } from '../slack/schema.ts';

export type SlackSystemCommand =
  | { type: 'slack.mention'; mention: SlackMention }
  | { type: 'slack.start_task'; mention: SlackMention }
  | { type: 'slack.record_status'; taskId: string; ts: string; reaction: string | null }
  | { type: 'slack.record_merge'; taskId: string; round: number; ts: string }
  | {
      type: 'slack.record_escalation';
      taskId: string;
      escalatedAt: number;
      contact: AutopilotContact;
      channelId: string | null;
      ts: string | null;
      problem: string | null;
    }
  | {
      type: 'slack.record_escalation_follow_up';
      taskId: string;
      escalatedAt: number;
      contact: AutopilotContact;
      ts: string;
    }
  | { type: 'slack.decide'; decision: SlackDecision };
