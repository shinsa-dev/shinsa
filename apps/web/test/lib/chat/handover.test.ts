import { describe, expect, it } from 'bun:test';
import { resolveAnsweredReply, resolveSupersededReply, resolveWithdrawnReply } from '@shinsa/core';
import {
  readPlanParameters,
  readProposedChange,
  resolveAskAnswer,
  resolveAskMeta,
  resolveSpotsMeta,
} from '@/lib/chat/handover.ts';
import { createToolCall, shinsaTool } from '../../support/chat.ts';

describe('resolveAskMeta', () => {
  const ask = shinsaTool('ask', { question: 'Which one?' });

  it('says the agent waits until the question has an answer', () => {
    expect(resolveAskMeta(createToolCall(ask), false)).toBe('Waiting for your answer');
    expect(resolveAskMeta(createToolCall(ask), true)).toBe('Waiting for an answer');
  });

  it('says whether the question was answered', () => {
    expect(resolveAskMeta(createToolCall(ask, { result: 'The first' }), false)).toBe('Answered');
    expect(resolveAskMeta(createToolCall(ask, { result: 'Cancelled', failed: true }), false)).toBe(
      'Not answered'
    );
  });

  it('marks a question withdrawn whether nothing came or a message of yours replaced the answer', () => {
    expect(resolveAskMeta(createToolCall(ask, { result: resolveWithdrawnReply() }), false)).toBe('Withdrawn');
    expect(
      resolveAskMeta(createToolCall(ask, { result: resolveSupersededReply('Use the grid.') }), false)
    ).toBe('Withdrawn');
  });
});

describe('resolveAskAnswer', () => {
  const ask = shinsaTool('ask', { question: 'Which one?' });

  it('shows the answer alone, without the words the agent reads around it', () => {
    const answered = createToolCall(ask, { result: resolveAnsweredReply('Shinsa’s projects', false) });
    expect(resolveAskAnswer(answered)).toBe('Shinsa’s projects');
    const delegated = createToolCall(ask, { result: resolveAnsweredReply('The second', true) });
    expect(resolveAskAnswer(delegated)).toBe('The second');
  });

  it('has no answer while it waits, when it failed or when it was withdrawn', () => {
    expect(resolveAskAnswer(createToolCall(ask))).toBeNull();
    expect(resolveAskAnswer(createToolCall(ask, { result: 'Cancelled', failed: true }))).toBeNull();
    expect(resolveAskAnswer(createToolCall(ask, { result: resolveWithdrawnReply() }))).toBeNull();
  });
});

describe('resolveSpotsMeta', () => {
  it('counts the spots a hand-over asks you to review', () => {
    expect(resolveSpotsMeta({ spots: [{ path: 'a.ts' }] })).toBe('1 spot to review');
    expect(resolveSpotsMeta({ spots: [{ path: 'a.ts' }, { path: 'b.ts' }] })).toBe('2 spots to review');
  });

  it('says nothing when there are no spots', () => {
    expect(resolveSpotsMeta({ spots: [] })).toBeNull();
    expect(resolveSpotsMeta({})).toBeNull();
  });
});

describe('readProposedChange', () => {
  it('reads the change a hand-over proposes, when it gives a reason', () => {
    expect(readProposedChange({ propose_change: { request: 'Release it.', why: 'It leaks.' } })).toEqual({
      why: 'It leaks.',
      request: 'Release it.',
    });
    expect(readProposedChange({ propose_change: { why: 'It leaks.' } })).toEqual({
      why: 'It leaks.',
      request: null,
    });
  });

  it('reads nothing from a hand-over without a proposal, or with a malformed one', () => {
    expect(readProposedChange({ findings: 'It leaks.' })).toBeNull();
    expect(readProposedChange({ propose_change: ['Release it.'] })).toBeNull();
    expect(readProposedChange({ propose_change: { request: 'Release it.' } })).toBeNull();
  });
});

describe('readPlanParameters', () => {
  it('reads the plan’s evidence, checks, impact and approval from the planner’s call', () => {
    expect(
      readPlanParameters({
        impact: 'About 400 rows.',
        evidence: ['screenshot', 'check', 'test'],
        checks: ['bun test', ''],
        approval: true,
      })
    ).toEqual({
      impact: 'About 400 rows.',
      evidence: ['screenshot', 'test'],
      checks: ['bun test'],
      approval: true,
    });
  });

  it('reads nothing from a plan without them', () => {
    expect(readPlanParameters({ goal: 'Ship it.' })).toEqual({
      impact: undefined,
      evidence: [],
      checks: [],
      approval: false,
    });
  });
});
