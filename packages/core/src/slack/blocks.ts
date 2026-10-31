import { escapeSlackText, fitSlackPlainText, fitSlackText } from './mrkdwn.ts';

export const SLACK_BLOCK_LIMITS = {
  section: 3000,
  fallback: 3000,
  blocks: 50,
} as const;

export interface SlackMrkdwn {
  type: 'mrkdwn';
  text: string;
}

export type SlackBlock = { type: 'section'; text: SlackMrkdwn };

export interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

export function createSlackSection(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text: fitSlackText(text, SLACK_BLOCK_LIMITS.section) } };
}

export function createSlackMessage(fallback: string, blocks: SlackBlock[]): SlackMessage {
  return {
    text: escapeSlackText(fitSlackPlainText(fallback, SLACK_BLOCK_LIMITS.fallback)),
    blocks: blocks.slice(0, SLACK_BLOCK_LIMITS.blocks),
  };
}
