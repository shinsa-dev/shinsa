import { escapeSlackText, fitSlackPlainText, fitSlackText } from './mrkdwn.ts';

export const SLACK_BLOCK_LIMITS = {
  section: 3000,
  context: 2000,
  contextElements: 10,
  fallback: 3000,
  blocks: 50,
} as const;

export interface SlackMrkdwn {
  type: 'mrkdwn';
  text: string;
}

export type SlackBlock =
  | { type: 'section'; text: SlackMrkdwn }
  | { type: 'context'; elements: SlackMrkdwn[] };

export interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

export function createSlackSection(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text: fitSlackText(text, SLACK_BLOCK_LIMITS.section) } };
}

export function createSlackContext(parts: string[]): SlackBlock {
  return {
    type: 'context',
    elements: parts
      .filter((part) => part.length > 0)
      .slice(0, SLACK_BLOCK_LIMITS.contextElements)
      .map((part) => ({ type: 'mrkdwn', text: fitSlackText(part, SLACK_BLOCK_LIMITS.context) })),
  };
}

export function createSlackMessage(fallback: string, blocks: SlackBlock[]): SlackMessage {
  return {
    text: escapeSlackText(fitSlackPlainText(fallback, SLACK_BLOCK_LIMITS.fallback)),
    blocks: blocks
      .filter((block) => block.type !== 'context' || block.elements.length > 0)
      .slice(0, SLACK_BLOCK_LIMITS.blocks),
  };
}
