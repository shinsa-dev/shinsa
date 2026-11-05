import { describe, expect, test } from 'bun:test';
import {
  isSlackDecidable,
  isSlackWriteDecision,
  listSlackDecidedBlocks,
  listSlackDecisions,
  parseSlackDecision,
  parseSlackDecisionModal,
  parseSlackDecisionReply,
  parseSlackDecisionValue,
  resolveSlackDecidedText,
  SLACK_GATE_BLOCK,
  SLACK_MODAL_CALLBACK,
  SLACK_RESPONSE_INPUT,
  type SlackDecision,
  serializeSlackDecidedView,
  serializeSlackDecisionModal,
  serializeSlackDecisionValue,
} from '../../src/index.ts';

const VALUE = { gateId: 'g1', decision: 'approve', choice: null, planVersion: 3 } as const;

const PLACE = { channelId: 'C1', threadTs: '100.1', messageTs: '100.9' };

const DECISION: SlackDecision = {
  ...VALUE,
  ...PLACE,
  interactionId: 'I1',
  teamId: 'T1',
  userId: 'U1',
  response: null,
};

describe('the value a decision button carries', () => {
  test('reads back what was written, with nulls filled in, and nothing that is not one', () => {
    expect(parseSlackDecisionValue(serializeSlackDecisionValue(VALUE))).toEqual(VALUE);
    expect(parseSlackDecisionValue(JSON.stringify({ gateId: 'g1', decision: 'reply', choice: 2 }))).toEqual({
      gateId: 'g1',
      decision: 'reply',
      choice: 2,
      planVersion: null,
    });
    for (const bad of [
      'not json',
      '[1]',
      JSON.stringify({ ...VALUE, gateId: 'g 1' }),
      JSON.stringify({ ...VALUE, decision: 'cancel' }),
      JSON.stringify({ ...VALUE, choice: -1 }),
      JSON.stringify({ ...VALUE, choice: 1.5 }),
      JSON.stringify({ ...VALUE, choice: 100 }),
      JSON.stringify({ ...VALUE, planVersion: 0 }),
    ])
      expect(parseSlackDecisionValue(bad)).toBeNull();
  });
});

describe('a decision forwarded to the machine', () => {
  test('is checked field by field, and a long answer is cut', () => {
    expect(parseSlackDecision(DECISION)).toEqual(DECISION);
    expect(parseSlackDecision({ ...DECISION, response: 'x'.repeat(5000) })?.response).toHaveLength(3000);
    expect(parseSlackDecision({ ...DECISION, userId: '' })).toBeNull();
    expect(parseSlackDecision({ ...DECISION, gateId: 'x'.repeat(65) })).toBeNull();
    expect(parseSlackDecision(null)).toBeNull();
  });

  test('its reply is decided with what to show, or refused with why', () => {
    expect(parseSlackDecisionReply({ decided: true, text: 'approved the plan' })).toEqual({
      decided: true,
      text: 'approved the plan',
    });
    expect(parseSlackDecisionReply({ decided: false, reason: 'x'.repeat(600) })).toEqual({
      decided: false,
      reason: 'x'.repeat(500),
    });
    expect(parseSlackDecisionReply({ decided: true })).toBeNull();
    expect(parseSlackDecisionReply('yes')).toBeNull();
  });
});

describe('what Slack may decide', () => {
  test('approves, asks for changes, answers, merges, retries and runs, but never cancels', () => {
    expect(listSlackDecisions('plan')).toEqual(['approve', 'revise']);
    expect(listSlackDecisions('secret')).toEqual([]);
    expect(isSlackDecidable('question', 'reply')).toBe(true);
    expect(isSlackDecidable('review', 'reject')).toBe(false);
    expect(isSlackDecidable('failure', 'reject')).toBe(false);
    expect(isSlackDecidable('operation', 'reject')).toBe(true);
    expect(isSlackWriteDecision('revise')).toBe(true);
    expect(isSlackWriteDecision('approve')).toBe(false);
  });

  test('says what was decided, in words for the card', () => {
    expect(resolveSlackDecidedText('plan', 'approve', null)).toBe('approved the plan');
    expect(resolveSlackDecidedText('proposal', 'reject', null)).toBe('kept the task as it is');
    expect(resolveSlackDecidedText('question', 'reply', ' CSV & <b> ')).toBe(
      'answered *CSV &amp; &lt;b&gt;*'
    );
    expect(resolveSlackDecidedText('question', 'reply', 'x'.repeat(300))).toBe(
      `answered *${'x'.repeat(199)}…*`
    );
    expect(resolveSlackDecidedText('secret', 'reply', null)).toBe('decided');
  });
});

describe('the card once someone decided', () => {
  test('swaps the gate’s buttons for who decided, and keeps every other block', () => {
    const decided = serializeSlackDecidedView('approved the plan', 'U1');
    expect(decided).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '<@U1> approved the plan' }],
    });
    const header = { type: 'header' };
    const buttons = { type: 'actions', block_id: `${SLACK_GATE_BLOCK}.g1`, elements: [] };
    const other = { type: 'actions', block_id: 'other', elements: [] };
    expect(listSlackDecidedBlocks([header, buttons, other, 'odd'], decided)).toEqual([
      header,
      decided,
      other,
      'odd',
    ]);
  });
});

describe('the form for written words', () => {
  test('asks for changes or an answer, and carries the decision and where it was made', () => {
    const metadata = { ...VALUE, decision: 'revise' as const, ...PLACE };
    const modal = serializeSlackDecisionModal(metadata) ?? never();
    expect(modal).toMatchObject({
      type: 'modal',
      callback_id: SLACK_MODAL_CALLBACK,
      title: { text: 'Request changes' },
      submit: { text: 'Send' },
      close: { text: 'Cancel' },
    });
    expect(modal.blocks[0]).toMatchObject({
      block_id: SLACK_RESPONSE_INPUT.block,
      label: { text: 'What should change?' },
      element: { action_id: SLACK_RESPONSE_INPUT.action, multiline: true, max_length: 3000 },
    });
    expect(parseSlackDecisionModal(modal.private_metadata)).toEqual(metadata);
    expect(serializeSlackDecisionModal({ ...metadata, decision: 'reply' })?.title.text).toBe('Answer');
    expect(serializeSlackDecisionModal({ ...metadata, decision: 'approve' })).toBeNull();
    expect(parseSlackDecisionModal(JSON.stringify(VALUE))).toBeNull();
  });
});

function never(): never {
  throw new Error('expected a value');
}
