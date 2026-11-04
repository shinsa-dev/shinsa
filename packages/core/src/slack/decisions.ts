import { Option, Schema } from 'effect';
import { isRecord } from '../domain/records.ts';
import type { GateDecision, GateType } from '../domain/types.ts';
import { escapeSlackText, fitSlackPlainText } from './mrkdwn.ts';
import {
  SLACK_LIMITS,
  SlackDecision,
  SlackDecisionModal,
  SlackDecisionReply,
  SlackDecisionValue,
} from './schema.ts';

export const SLACK_ENGINE_INTERACTIONS_PATH = '/api/slack/interactions';

export const SLACK_OPEN_ACTION = 'shinsa.open';

export const SLACK_DECIDE_ACTION = 'shinsa.decide';

export const SLACK_WRITE_ACTION = 'shinsa.write';

export const SLACK_GATE_BLOCK = 'shinsa.gate';

export const SLACK_MODAL_CALLBACK = 'shinsa.decision';

export const SLACK_RESPONSE_INPUT = { block: 'shinsa.response', action: 'shinsa.response.text' } as const;

const SLACK_MODAL_TITLE_LIMIT = 24;

const SLACK_DECIDED_CHOICE_LIMIT = 200;

const SLACK_DECIDABLE: Readonly<Partial<Record<GateType, readonly GateDecision[]>>> = {
  plan: ['approve', 'revise'],
  review: ['approve', 'revise'],
  merge: ['approve'],
  question: ['reply'],
  proposal: ['approve', 'reject'],
  failure: ['approve'],
  operation: ['approve', 'reject'],
};

const DECIDED_TEXT: Readonly<Partial<Record<GateType, Partial<Record<GateDecision, string>>>>> = {
  plan: { approve: 'approved the plan', revise: 'asked for changes to the plan' },
  review: { approve: 'approved the work', revise: 'asked for changes' },
  merge: { approve: 'approved the merge' },
  proposal: { approve: 'approved the change', reject: 'kept the task as it is' },
  failure: { approve: 'retried it' },
  operation: { approve: 'ran the operation', reject: 'finished without the operation' },
};

export type SlackWriteDecision = Extract<GateDecision, 'revise' | 'reply'>;

const MODAL_COPY: Record<SlackWriteDecision, { title: string; label: string; submit: string }> = {
  revise: { title: 'Request changes', label: 'What should change?', submit: 'Send' },
  reply: { title: 'Answer', label: 'Your answer', submit: 'Send' },
};

interface SlackPlainText {
  type: 'plain_text';
  text: string;
  emoji: false;
}

export interface SlackModal {
  type: 'modal';
  callback_id: string;
  private_metadata: string;
  title: SlackPlainText;
  submit: SlackPlainText;
  close: SlackPlainText;
  blocks: {
    type: 'input';
    block_id: string;
    label: SlackPlainText;
    element: { type: 'plain_text_input'; action_id: string; multiline: true; max_length: number };
  }[];
}

const decodeValue = Schema.decodeUnknownOption(Schema.fromJsonString(SlackDecisionValue));

const decodeModal = Schema.decodeUnknownOption(Schema.fromJsonString(SlackDecisionModal));

const decodeDecision = Schema.decodeUnknownOption(SlackDecision);

const decodeReply = Schema.decodeUnknownOption(SlackDecisionReply);

export function listSlackDecisions(type: GateType): readonly GateDecision[] {
  return SLACK_DECIDABLE[type] ?? [];
}

export function isSlackDecidable(type: GateType, decision: GateDecision) {
  return listSlackDecisions(type).includes(decision);
}

export function isSlackWriteDecision(decision: GateDecision): decision is SlackWriteDecision {
  return decision === 'revise' || decision === 'reply';
}

export function serializeSlackDecisionValue(value: SlackDecisionValue) {
  return JSON.stringify(value);
}

export function parseSlackDecisionValue(text: string): SlackDecisionValue | null {
  return Option.getOrNull(decodeValue(text));
}

export function parseSlackDecisionModal(text: string): SlackDecisionModal | null {
  return Option.getOrNull(decodeModal(text));
}

export function parseSlackDecision(value: unknown): SlackDecision | null {
  return Option.getOrNull(decodeDecision(value));
}

export function parseSlackDecisionReply(value: unknown): SlackDecisionReply | null {
  return Option.getOrNull(decodeReply(value));
}

function resolveDecidedChoice(response: string) {
  const text = response.trim();
  return text.length > SLACK_DECIDED_CHOICE_LIMIT
    ? `${text.slice(0, SLACK_DECIDED_CHOICE_LIMIT - 1).trimEnd()}…`
    : text;
}

export function resolveSlackDecidedText(type: GateType, decision: GateDecision, response: string | null) {
  if (type === 'question') return `answered *${escapeSlackText(resolveDecidedChoice(response ?? ''))}*`;
  return DECIDED_TEXT[type]?.[decision] ?? 'decided';
}

export function serializeSlackDecidedView(text: string, userId: string) {
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `<@${userId}> ${text}` }],
  };
}

function isGateActions(block: unknown) {
  return (
    isRecord(block) &&
    block.type === 'actions' &&
    typeof block.block_id === 'string' &&
    block.block_id.startsWith(SLACK_GATE_BLOCK)
  );
}

export function listSlackDecidedBlocks(blocks: readonly unknown[], decided: unknown): unknown[] {
  return blocks.map((block) => (isGateActions(block) ? decided : block));
}

function createPlainText(text: string, limit: number): SlackPlainText {
  return { type: 'plain_text', text: fitSlackPlainText(text, limit), emoji: false };
}

export function serializeSlackDecisionModal(metadata: SlackDecisionModal): SlackModal | null {
  if (!isSlackWriteDecision(metadata.decision)) return null;
  const copy = MODAL_COPY[metadata.decision];
  return {
    type: 'modal',
    callback_id: SLACK_MODAL_CALLBACK,
    private_metadata: JSON.stringify(metadata),
    title: createPlainText(copy.title, SLACK_MODAL_TITLE_LIMIT),
    submit: createPlainText(copy.submit, SLACK_MODAL_TITLE_LIMIT),
    close: createPlainText('Cancel', SLACK_MODAL_TITLE_LIMIT),
    blocks: [
      {
        type: 'input',
        block_id: SLACK_RESPONSE_INPUT.block,
        label: createPlainText(copy.label, 2000),
        element: {
          type: 'plain_text_input',
          action_id: SLACK_RESPONSE_INPUT.action,
          multiline: true,
          max_length: SLACK_LIMITS.text,
        },
      },
    ],
  };
}
