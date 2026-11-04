import type { SlackDecided, SlackThreadLink } from '../domain/slack.ts';

export type SlackEventBody =
  | { type: 'slack.thread_linked'; taskId: string; link: SlackThreadLink }
  | { type: 'slack.status_posted'; taskId: string; ts: string; reaction: string | null }
  | { type: 'slack.decided'; taskId: string; decided: SlackDecided }
  | { type: 'slack.merge_announced'; taskId: string; round: number }
  | { type: 'slack.merge_posted'; taskId: string; round: number; ts: string };
