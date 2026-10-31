import type { SlackMention } from '../slack/contract.ts';

export type SlackSystemCommand =
  | { type: 'slack.mention'; mention: SlackMention }
  | { type: 'slack.start_task'; mention: SlackMention; statusTs: string | null }
  | { type: 'slack.record_status'; taskId: string; ts: string };
