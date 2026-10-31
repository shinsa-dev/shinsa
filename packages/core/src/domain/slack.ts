export interface SlackThreadRef {
  teamId: string;
  channelId: string;
  threadTs: string;
}

export interface SlackThreadLink extends SlackThreadRef {
  userId: string;
  messageTs: string;
  permalink: string | null;
  statusTs: string | null;
  reaction: string | null;
}

export function resolveSlackThreadKey(thread: SlackThreadRef) {
  return `${thread.teamId}:${thread.channelId}:${thread.threadTs}`;
}

export function isSameSlackThread(left: SlackThreadRef, right: SlackThreadRef) {
  return resolveSlackThreadKey(left) === resolveSlackThreadKey(right);
}
