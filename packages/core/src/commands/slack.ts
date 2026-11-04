import type { SlackDecision, SlackMention } from '../slack/schema.ts';

export type SlackSystemCommand =
  | { type: 'slack.mention'; mention: SlackMention }
  | { type: 'slack.start_task'; mention: SlackMention }
  | { type: 'slack.record_status'; taskId: string; ts: string; reaction: string | null }
  | { type: 'slack.record_merge'; taskId: string; round: number; ts: string }
  | { type: 'slack.decide'; decision: SlackDecision };
