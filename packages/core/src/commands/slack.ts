import type { SlackAnswer } from '../slack/answers.ts';
import type { SlackMention } from '../slack/contract.ts';

export type SlackSystemCommand =
  | { type: 'slack.mention'; mention: SlackMention }
  | { type: 'slack.start_task'; mention: SlackMention }
  | { type: 'slack.record_status'; taskId: string; ts: string; reaction: string | null }
  | { type: 'slack.answer'; answer: SlackAnswer };
