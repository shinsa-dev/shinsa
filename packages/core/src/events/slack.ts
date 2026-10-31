import type { SlackThreadLink } from '../domain/slack.ts';

export type SlackEventBody =
  | { type: 'slack.thread_linked'; taskId: string; link: SlackThreadLink }
  | { type: 'slack.status_posted'; taskId: string; ts: string; reaction: string | null };
