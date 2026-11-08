import type { AutopilotSlackContact } from './settings.ts';

export interface SlackEscalationPost {
  escalatedAt: number;
  contact: AutopilotSlackContact;
  channelId: string | null;
  ts: string | null;
}

export function describeSlackContact(contact: AutopilotSlackContact) {
  return contact.kind === 'slack_channel' ? `#${contact.name}` : contact.name;
}

export interface SlackThreadRef {
  teamId: string;
  channelId: string;
  threadTs: string;
}

export interface SlackDecided {
  userId: string;
  text: string;
}

interface SlackMergePost {
  round: number;
  ts: string | null;
}

export interface SlackThreadLink extends SlackThreadRef {
  userId: string;
  messageTs: string;
  permalink: string | null;
  channelName: string | null;
  statusTs: string | null;
  reaction: string | null;
  decided?: SlackDecided | null;
  merge?: SlackMergePost | null;
}

export function resolveSlackThreadKey(thread: SlackThreadRef) {
  return `${thread.teamId}:${thread.channelId}:${thread.threadTs}`;
}

export function isSameSlackThread(left: SlackThreadRef, right: SlackThreadRef) {
  return resolveSlackThreadKey(left) === resolveSlackThreadKey(right);
}

export function resolveSlackThreadUrl(link: SlackThreadLink) {
  if (link.permalink) return link.permalink;
  const thread = `${link.channelId}-${link.threadTs}`;
  return `https://app.slack.com/client/${link.teamId}/${link.channelId}/thread/${thread}`;
}
