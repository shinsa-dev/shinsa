import type { SlackMention } from '../slack/contract.ts';

export type SlackSystemCommand =
  | { type: 'slack.mention'; mention: SlackMention }
  | { type: 'slack.record_status'; taskId: string; ts: string };
