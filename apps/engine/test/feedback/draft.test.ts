import { describe, expect, test } from 'bun:test';
import { FEEDBACK_LIMITS } from '@shinsa/core';
import { createFeedbackDrafter, describeFeedbackPrompt } from '../../src/feedback/draft.ts';

function createAsk(answer: unknown) {
  const calls: { system: string; prompt: string; schema: unknown }[] = [];
  const ask = <T>(system: string, prompt: string, schema?: unknown) => {
    calls.push({ system, prompt, schema });
    return Promise.resolve(answer as T | null);
  };
  return { ask, calls };
}

const INPUT = {
  source: 'human' as const,
  note: 'The plan tab hides my changes.',
  privateWords: ['paywall-next', 'SW'],
};

describe('drafting feedback as a public issue', () => {
  test('asks the writer with the source, the private words and the note, and keeps a one-line title', async () => {
    const { ask, calls } = createAsk({
      title: ' Plan tab hides changes \nmore',
      body: ' The plan tab hides the changes. ',
    });
    expect(await createFeedbackDrafter(ask)(INPUT)).toEqual({
      title: 'Plan tab hides changes',
      body: 'The plan tab hides the changes.',
    });
    expect(calls[0]?.prompt).toBe(describeFeedbackPrompt(INPUT));
    expect(calls[0]?.prompt).toBe(
      [
        'From: the person using Shinsa, through its feedback button.',
        'Private words: paywall-next, SW',
        'Feedback:',
        'The plan tab hides my changes.',
      ].join('\n')
    );
    expect(calls[0]?.system).toContain('The issue is public');
    expect(calls[0]?.schema).toMatchObject({ required: ['title', 'body'] });
  });

  test('says an agent sent it and that there are no private words when there are none', () => {
    const prompt = describeFeedbackPrompt({ source: 'agent', note: 'x', privateWords: [] });
    expect(prompt).toContain('From: a coding agent working in Shinsa');
    expect(prompt).toContain('Private words: none');
  });

  test('gives no draft when the writer gave nothing, an empty field or one too long', async () => {
    const draft = (answer: unknown) => createFeedbackDrafter(createAsk(answer).ask)(INPUT);
    expect(await draft(null)).toBeNull();
    expect(await draft({ title: '  ', body: 'Body.' })).toBeNull();
    expect(await draft({ title: 3, body: 'Body.' })).toBeNull();
    expect(await draft({ title: 'x'.repeat(FEEDBACK_LIMITS.title + 1), body: 'Body.' })).toBeNull();
    expect(await draft({ title: 'Title', body: 'x'.repeat(FEEDBACK_LIMITS.body + 1) })).toBeNull();
    expect(await draft({ title: 'Title', body: 7 })).toBeNull();
  });
});
