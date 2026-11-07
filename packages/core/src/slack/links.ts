import { SLACK_LIMITS, type SlackMessageLink } from './schema.ts';

const SLACK_MESSAGE_LINK =
  /https:\/\/(?:[a-z0-9-]+\.)+slack\.com\/archives\/([CG][A-Z0-9]{1,30})\/p(\d{10})(\d{6})(\?[^\s|<>]*)?/g;

const SLACK_TS = /^\d{10}\.\d{6}$/;

function resolveThreadTs(messageTs: string, query: string | undefined) {
  const threadTs = new URLSearchParams((query ?? '').replaceAll('&amp;', '&')).get('thread_ts');
  return threadTs && SLACK_TS.test(threadTs) ? threadTs : messageTs;
}

export function listSlackMessageLinks(text: string): SlackMessageLink[] {
  const links: SlackMessageLink[] = [];
  for (const match of text.matchAll(SLACK_MESSAGE_LINK)) {
    const [permalink, channelId, seconds, micros, query] = match;
    if (!channelId || !seconds || !micros || permalink.length > SLACK_LIMITS.permalink) continue;
    const threadTs = resolveThreadTs(`${seconds}.${micros}`, query);
    if (links.some((link) => link.channelId === channelId && link.threadTs === threadTs)) continue;
    links.push({ channelId, threadTs, permalink });
    if (links.length === SLACK_LIMITS.linkedThreads) break;
  }
  return links;
}
