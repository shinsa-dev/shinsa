import { escapeSlackText, fitSlackPlainText, fitSlackText } from './mrkdwn.ts';

export const SLACK_BLOCK_LIMITS = {
  section: 3000,
  field: 2000,
  fields: 10,
  header: 150,
  context: 10,
  button: 75,
  buttons: 5,
  value: 2000,
  fallback: 3000,
  blocks: 50,
} as const;

export interface SlackMrkdwn {
  type: 'mrkdwn';
  text: string;
}

interface SlackPlainText {
  type: 'plain_text';
  text: string;
  emoji?: boolean;
}

export interface SlackButton {
  type: 'button';
  action_id: string;
  text: SlackPlainText;
  url?: string;
  value?: string;
  style?: 'primary' | 'danger';
}

export type SlackBlock =
  | { type: 'header'; text: SlackPlainText }
  | { type: 'section'; text: SlackMrkdwn }
  | { type: 'section'; fields: SlackMrkdwn[] }
  | { type: 'context'; elements: SlackMrkdwn[] }
  | { type: 'actions'; block_id?: string; elements: SlackButton[] };

export interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

function createMrkdwn(text: string, limit: number): SlackMrkdwn {
  return { type: 'mrkdwn', text: fitSlackText(text, limit) };
}

export function createSlackHeader(text: string): SlackBlock {
  return {
    type: 'header',
    text: { type: 'plain_text', text: fitSlackPlainText(text, SLACK_BLOCK_LIMITS.header), emoji: false },
  };
}

export function createSlackSection(text: string): SlackBlock {
  return { type: 'section', text: createMrkdwn(text, SLACK_BLOCK_LIMITS.section) };
}

export function createSlackFields(fields: readonly { label: string; value: string }[]): SlackBlock {
  return {
    type: 'section',
    fields: fields
      .slice(0, SLACK_BLOCK_LIMITS.fields)
      .map((field) =>
        createMrkdwn(`*${escapeSlackText(field.label)}*\n${field.value}`, SLACK_BLOCK_LIMITS.field)
      ),
  };
}

export function createSlackContext(elements: readonly string[]): SlackBlock {
  return {
    type: 'context',
    elements: elements
      .slice(0, SLACK_BLOCK_LIMITS.context)
      .map((element) => createMrkdwn(element, SLACK_BLOCK_LIMITS.field)),
  };
}

export interface SlackButtonInput {
  actionId: string;
  label: string;
  url?: string;
  value?: string;
  primary?: boolean;
}

export function createSlackButton(input: SlackButtonInput): SlackButton {
  return {
    type: 'button',
    action_id: input.actionId,
    text: {
      type: 'plain_text',
      text: fitSlackPlainText(input.label, SLACK_BLOCK_LIMITS.button),
      emoji: false,
    },
    ...(input.url ? { url: input.url } : {}),
    ...(input.value ? { value: input.value.slice(0, SLACK_BLOCK_LIMITS.value) } : {}),
    ...(input.primary ? { style: 'primary' as const } : {}),
  };
}

export function createSlackActions(buttons: readonly SlackButton[], blockId?: string): SlackBlock {
  return {
    type: 'actions',
    ...(blockId ? { block_id: blockId } : {}),
    elements: buttons.slice(0, SLACK_BLOCK_LIMITS.buttons + 1),
  };
}

export function createSlackMessage(fallback: string, blocks: SlackBlock[]): SlackMessage {
  return {
    text: escapeSlackText(fitSlackPlainText(fallback, SLACK_BLOCK_LIMITS.fallback)),
    blocks: blocks.slice(0, SLACK_BLOCK_LIMITS.blocks),
  };
}
