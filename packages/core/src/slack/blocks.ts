import { escapeSlackText, fitSlackPlainText, fitSlackText } from './mrkdwn.ts';

export const SLACK_BLOCK_LIMITS = {
  section: 3000,
  header: 150,
  context: 2000,
  contextElements: 10,
  button: 75,
  url: 3000,
  fallback: 3000,
  blocks: 50,
} as const;

export interface SlackMrkdwn {
  type: 'mrkdwn';
  text: string;
}

export interface SlackPlainText {
  type: 'plain_text';
  text: string;
  emoji: true;
}

export interface SlackButton {
  type: 'button';
  action_id: string;
  text: SlackPlainText;
  url: string;
  style?: 'primary';
}

export type SlackBlock =
  | { type: 'header'; text: SlackPlainText }
  | { type: 'section'; text: SlackMrkdwn; accessory?: SlackButton }
  | { type: 'context'; elements: SlackMrkdwn[] }
  | { type: 'divider' }
  | { type: 'actions'; elements: SlackButton[] };

export interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

export function createSlackHeader(text: string): SlackBlock {
  return {
    type: 'header',
    text: { type: 'plain_text', text: fitSlackPlainText(text, SLACK_BLOCK_LIMITS.header), emoji: true },
  };
}

export function createSlackSection(text: string, accessory?: SlackButton): SlackBlock {
  const section: SlackBlock = {
    type: 'section',
    text: { type: 'mrkdwn', text: fitSlackText(text, SLACK_BLOCK_LIMITS.section) },
  };
  return accessory ? { ...section, accessory } : section;
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

export function createSlackButton(label: string, url: string, primary = false): SlackButton {
  return {
    type: 'button',
    action_id: 'open_in_shinsa',
    text: { type: 'plain_text', text: fitSlackPlainText(label, SLACK_BLOCK_LIMITS.button), emoji: true },
    url: url.slice(0, SLACK_BLOCK_LIMITS.url),
    ...(primary ? { style: 'primary' as const } : {}),
  };
}

export function createSlackActions(buttons: SlackButton[]): SlackBlock {
  return { type: 'actions', elements: buttons };
}

export function createSlackMessage(fallback: string, blocks: SlackBlock[]): SlackMessage {
  return {
    text: escapeSlackText(fitSlackPlainText(fallback, SLACK_BLOCK_LIMITS.fallback)),
    blocks: blocks
      .filter((block) => block.type !== 'context' || block.elements.length > 0)
      .slice(0, SLACK_BLOCK_LIMITS.blocks),
  };
}
