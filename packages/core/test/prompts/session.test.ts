import { describe, expect, test } from 'bun:test';
import {
  QUESTION_WITHDRAWN,
  resolveAnswerPrompt,
  resolveContinuePrompt,
  resolveQuestionResumePrompt,
  resolveSteerPrompt,
  resolveSupersededReply,
  resolveWithdrawnReply,
} from '../../src/index.ts';
import {
  resolveFreshSessionNudge,
  resolveRecoveryNudge,
  resolveUsageResumeNudge,
} from '../../src/prompts/session.ts';

describe('the restart prompt', () => {
  test('tells the agent to carry on and to re-check the edit or command it was in the middle of', () => {
    const prompt = resolveContinuePrompt();
    expect(prompt).toContain('Shinsa restarted while you were working');
    expect(prompt).toContain('Continue exactly where you left off');
    expect(prompt).toContain(
      're-check the state of any file you were editing and any command you had running'
    );
  });
});

describe('steering', () => {
  test('a message leads with the notice that the human is talking mid-step', () => {
    expect(resolveSteerPrompt('Use the blue one.')).toBe(
      [
        '<system-message>',
        'The human wants to tell you something while you keep working. Acknowledge it in one short sentence, then continue your step and take it into account.',
        '</system-message>',
        '',
        'Use the blue one.',
      ].join('\n')
    );
  });

  test('a slash command stays first so the agent still expands it, and an empty message is just the notice', () => {
    expect(resolveSteerPrompt('/review now')).toStartWith('/review now\n\n<system-message>');
    expect(resolveSteerPrompt('   ')).toStartWith('<system-message>');
    expect(resolveSteerPrompt('   ')).toEndWith('</system-message>');
  });
});

describe('recovery nudges', () => {
  test('a resumed session is told why it stopped; a fresh one is told to read the worktree first', () => {
    expect(resolveRecoveryNudge('it crashed')).toBe(
      '\n\nYour previous attempt ended without handing over (it crashed). Continue and finish with the hand-over tool.'
    );
    const fresh = resolveFreshSessionNudge('the context window is full');
    expect(fresh).toContain('could not go on (the context window is full)');
    expect(fresh).toContain('`git status` and `git diff`');
  });
});

describe('resolveUsageResumeNudge', () => {
  test('tells the resumed agent the usage limit reset and to finish with the hand-over tool', () => {
    expect(resolveUsageResumeNudge()).toBe(
      '\n\nYour previous turn stopped because the usage limit was reached. The limit has reset.\nContinue where you left off and finish the step with the hand-over tool.'
    );
  });
});

describe('session prompts', () => {
  test('an answer repeats the question', () => {
    expect(resolveAnswerPrompt('Which width?', '240')).toBe(
      'You asked the human: Which width?\n\nTheir answer: 240\n\nCarry on.'
    );
  });

  test('a message that superseded the question repeats the question and says it was not answered', () => {
    expect(resolveQuestionResumePrompt('Which width?', { kind: 'superseded', text: 'Use the grid.' })).toBe(
      'You asked the human: Which width?\n\nThe question was withdrawn. The human wrote this instead: Use the grid.\n\nCarry on.'
    );
  });

  test('a question withdrawn with nothing in its place tells the agent to carry on, and both replies start alike', () => {
    expect(resolveWithdrawnReply()).toBe('The question was withdrawn. Continue with your best judgement.');
    expect(resolveWithdrawnReply().startsWith(QUESTION_WITHDRAWN)).toBe(true);
    expect(resolveSupersededReply('x').startsWith(QUESTION_WITHDRAWN)).toBe(true);
  });
});
