import { SLACK_LIMITS } from './contract.ts';

export const SLACK_ENGINE_INTERACTIONS_PATH = '/api/slack/interactions';

export const SLACK_ANSWER_ACTION = 'shinsa.answer';

export const SLACK_OPEN_ACTION = 'shinsa.open';

export const SLACK_QUESTION_BLOCK = 'shinsa.question';

const CHOICE_LIMIT = 100;

export interface SlackAnswer {
  interactionId: string;
  teamId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId: string;
  gateId: string;
  choice: number;
}

export type SlackAnswerReply = { answered: true; choice: string } | { answered: false; reason: string };

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readId(fields: Fields, key: string) {
  const value = fields[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > SLACK_LIMITS.id) return null;
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

function readChoice(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < CHOICE_LIMIT
    ? value
    : null;
}

export function serializeSlackAnswerValue(gateId: string, choice: number) {
  return JSON.stringify({ gateId, choice });
}

export function parseSlackAnswerValue(value: string): { gateId: string; choice: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isFields(parsed)) return null;
  const gateId = readId(parsed, 'gateId');
  const choice = readChoice(parsed.choice);
  return gateId && choice !== null ? { gateId, choice } : null;
}

export function parseSlackAnswer(value: unknown): SlackAnswer | null {
  if (!isFields(value)) return null;
  const interactionId = readId(value, 'interactionId');
  const teamId = readId(value, 'teamId');
  const channelId = readId(value, 'channelId');
  const threadTs = readId(value, 'threadTs');
  const messageTs = readId(value, 'messageTs');
  const userId = readId(value, 'userId');
  const gateId = readId(value, 'gateId');
  const choice = readChoice(value.choice);
  if (!interactionId || !teamId || !channelId || !threadTs || !messageTs || !userId || !gateId) return null;
  if (choice === null) return null;
  return { interactionId, teamId, channelId, threadTs, messageTs, userId, gateId, choice };
}

export function parseSlackAnswerReply(value: unknown): SlackAnswerReply | null {
  if (!isFields(value)) return null;
  if (value.answered === true && typeof value.choice === 'string')
    return { answered: true, choice: value.choice };
  if (value.answered === false && typeof value.reason === 'string')
    return { answered: false, reason: value.reason.slice(0, 500) };
  return null;
}

function isQuestionActions(block: unknown) {
  return (
    isFields(block) &&
    block.type === 'actions' &&
    typeof block.block_id === 'string' &&
    block.block_id.startsWith(SLACK_QUESTION_BLOCK)
  );
}

export function listSlackAnsweredBlocks(blocks: readonly unknown[], answered: unknown): unknown[] {
  return blocks.map((block) => (isQuestionActions(block) ? answered : block));
}
