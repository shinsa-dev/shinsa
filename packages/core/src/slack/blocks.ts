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
  planTitle: 150,
  planTasks: 50,
  taskTitle: 150,
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

export type SlackTaskStatus = 'pending' | 'in_progress' | 'complete' | 'error';

export interface SlackRichText {
  type: 'rich_text';
  elements: { type: 'rich_text_section'; elements: { type: 'text'; text: string }[] }[];
}

export interface SlackPlanTask {
  task_id: string;
  title: string;
  status: SlackTaskStatus;
  details?: SlackRichText;
}

export type SlackStreamChunk =
  | { type: 'plan_update'; title: string }
  | {
      type: 'task_update';
      id: string;
      title: string;
      status: Exclude<SlackTaskStatus, 'pending'>;
      details?: SlackRichText;
      output?: SlackRichText;
    };

export type SlackBlock =
  | { type: 'header'; text: SlackPlainText }
  | { type: 'section'; text: SlackMrkdwn; accessory?: SlackButton }
  | { type: 'context'; elements: SlackMrkdwn[] }
  | { type: 'divider' }
  | { type: 'actions'; elements: SlackButton[] }
  | { type: 'plan'; block_id: string; title: string; tasks: SlackPlanTask[] };

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

export function createSlackRichText(text: string): SlackRichText {
  return { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text }] }] };
}

function resolveContentHash(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function createSlackPlan(title: string, tasks: SlackPlanTask[]): SlackBlock {
  const fitted = tasks.slice(0, SLACK_BLOCK_LIMITS.planTasks).map((task) => ({
    ...task,
    title: fitSlackPlainText(task.title, SLACK_BLOCK_LIMITS.taskTitle),
  }));
  const planTitle = fitSlackPlainText(title, SLACK_BLOCK_LIMITS.planTitle);
  return {
    type: 'plan',
    block_id: `plan-${resolveContentHash(JSON.stringify([planTitle, fitted]))}`,
    title: planTitle,
    tasks: fitted,
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
