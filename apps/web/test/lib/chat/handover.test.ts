import { describe, expect, it } from 'bun:test';
import {
  resolveAnsweredReply,
  resolveSupersededReply,
  resolveWithdrawnReply,
  serializeAttachments,
} from '@shinsa/core';
import {
  hasHandOverWalkthrough,
  readHandOverReply,
  readHandOverSpots,
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
    expect(resolveAskAnswer(answered)).toEqual({ text: 'Shinsa’s projects', attachments: [] });
    const delegated = createToolCall(ask, { result: resolveAnsweredReply('The second', true) });
    expect(resolveAskAnswer(delegated)).toEqual({ text: 'The second', attachments: [] });
  });

  it('takes the files you attached out of the answer’s text', () => {
    const file = {
      kind: 'image' as const,
      name: 'shot.png',
      url: '/api/attachments/1/shot.png',
      path: '/d/shot.png',
      mimeType: 'image/png',
      size: 4,
    };
    const answered = createToolCall(ask, {
      result: resolveAnsweredReply(serializeAttachments('Like this', [file]), false),
    });
    expect(resolveAskAnswer(answered)).toEqual({
      text: 'Like this',
      attachments: [{ kind: 'image', name: 'shot.png', url: file.url, mimeType: 'image/png', size: 4 }],
    });
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
  it('reads the plan’s evidence, checks, impact and approval from the agent’s call', () => {
    expect(
      readPlanParameters({
        impact: 'About 400 rows.',
        evidence: ['screenshot', 'check', 'test'],
        verification: [
          { label: 'Tests', command: 'bun test a.test.ts', phases: [1, 0, 'x', 2] },
          { command: 'bun run lint' },
          { label: 'No command' },
          'bun test',
        ],
        approval: true,
      })
    ).toEqual({
      impact: 'About 400 rows.',
      evidence: ['screenshot', 'test'],
      verification: [
        { label: 'Tests', command: 'bun test a.test.ts', phases: [1, 2] },
        { label: 'bun run lint', command: 'bun run lint', phases: [] },
      ],
      approval: true,
    });
  });

  it('reads nothing from a plan without them', () => {
    expect(readPlanParameters({ goal: 'Ship it.' })).toEqual({
      impact: undefined,
      evidence: [],
      verification: [],
      approval: false,
    });
  });
});

describe('readHandOverSpots', () => {
  it('reads each spot with its file, lines and reason', () => {
    expect(
      readHandOverSpots({
        spots: [
          { file: 'a.ts', start: 3, end: 5, why: 'The order.' },
          { file: 'b.ts', start: 7 },
          { file: 'c.ts', start: 9, end: 2 },
        ],
      })
    ).toEqual([
      { file: 'a.ts', start: 3, end: 5, why: 'The order.' },
      { file: 'b.ts', start: 7, end: 7, why: null },
      { file: 'c.ts', start: 9, end: 9, why: null },
    ]);
  });

  it('leaves out a spot without a file or a first line', () => {
    expect(
      readHandOverSpots({ spots: [{ start: 1 }, { file: 'a.ts' }, { file: 'a.ts', start: 0 }] })
    ).toEqual([]);
    expect(readHandOverSpots({})).toEqual([]);
  });
});

describe('hasHandOverWalkthrough', () => {
  it('is true only when the hand-over carries a walkthrough', () => {
    expect(hasHandOverWalkthrough({ walkthrough: { approach: 'A' } })).toBe(true);
    expect(hasHandOverWalkthrough({ walkthrough: null })).toBe(false);
    expect(hasHandOverWalkthrough({ walkthrough: ['A'] })).toBe(false);
    expect(hasHandOverWalkthrough({ summary: 'S' })).toBe(false);
  });
});

describe('readHandOverReply', () => {
  it('reads the reply a hand-over carries, dropping points it cannot show', () => {
    expect(
      readHandOverReply({
        reply: {
          headline: 'Added the test phase.',
          points: [
            { ask: 'Add a test phase', outcome: 'done', note: 'Phase 3.' },
            { ask: 'Why two phases?', outcome: 'answered' },
            { ask: 'Unknown', outcome: 'maybe', note: 'x' },
            { outcome: 'done', note: 'No ask.' },
          ],
          next: 'Approve the plan.',
        },
      })
    ).toEqual({
      headline: 'Added the test phase.',
      points: [
        { ask: 'Add a test phase', outcome: 'done', note: 'Phase 3.' },
        { ask: 'Why two phases?', outcome: 'answered', note: '' },
      ],
      next: 'Approve the plan.',
    });
  });

  it('has no reply without one, without a headline or when it is not an object', () => {
    expect(readHandOverReply({ summary: 'S' })).toBeNull();
    expect(readHandOverReply({ reply: { points: [] } })).toBeNull();
    expect(readHandOverReply({ reply: ['A'] })).toBeNull();
    expect(readHandOverReply({ reply: { headline: 'Done.' } })).toEqual({
      headline: 'Done.',
      points: [],
      next: null,
    });
  });
});
