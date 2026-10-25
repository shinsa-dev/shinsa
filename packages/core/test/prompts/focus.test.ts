import { describe, expect, test } from 'bun:test';
import {
  resolveChecksFixPrompt,
  resolveConflictFixPrompt,
  resolveFixFocus,
  resolveHouseRules,
  resolveHumanFixPrompt,
  resolvePullRequestFixPrompt,
  resolveReviewFixPrompt,
  resolveVerdictFixPrompt,
  resolveWorkspaceUpdatedFixPrompt,
} from '../../src/prompts/index.ts';
import { buildAll, createHarness, createTask, failing, pullRequest } from '../harness.ts';

const finding = { severity: 'blocking' as const, file: null, line: null, message: 'Handle the timeout.' };

function briefed(instruction: string) {
  return `${resolveHouseRules('agent')}\n\n${instruction}`;
}

describe('resolveFixFocus', () => {
  test('names what each fix prompt is for, after the house rules', () => {
    const cases = [
      [resolveChecksFixPrompt([{ name: 'test', outcome: 'fail', detail: '' }]), 'checks'],
      [resolveReviewFixPrompt([finding]), 'review'],
      [resolveHumanFixPrompt('Rename it.', []), 'changes'],
      [resolveVerdictFixPrompt([{ ...finding, verdict: 'fix' }], null, []), 'changes'],
      [resolvePullRequestFixPrompt(pullRequest({ number: 42 })), 'pull_request'],
      [resolveConflictFixPrompt('feat/banner'), 'conflicts'],
      [resolveWorkspaceUpdatedFixPrompt('feat/banner', null), 'conflicts'],
    ] as const;
    for (const [instruction, focus] of cases) {
      expect(resolveFixFocus({ purpose: 'fix', prompt: briefed(instruction) })).toBe(focus);
      expect(resolveFixFocus({ purpose: 'fix', prompt: instruction })).toBe(focus);
    }
  });

  test('reads the short instruction of a fix that carries the round brief', () => {
    const run = {
      purpose: 'fix' as const,
      prompt: briefed('Your conversation may no longer hold this round.\n\nThe checks failed:'),
      rolePrompt: briefed('The human looked at the work and wrote:'),
    };
    expect(resolveFixFocus(run)).toBe('changes');
  });

  test('names nothing for a run that is not a fix, an unknown instruction or no prompt', () => {
    expect(resolveFixFocus({ purpose: 'build', prompt: briefed('The checks failed') })).toBeNull();
    expect(resolveFixFocus({ prompt: 'The checks failed' })).toBeNull();
    expect(resolveFixFocus({ purpose: 'fix', prompt: briefed('Something else') })).toBeNull();
    expect(resolveFixFocus({ purpose: 'fix' })).toBeNull();
  });

  test('names the fix the decider starts when the checks fail', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    expect(resolveFixFocus(harness.activeRun(taskId))).toBe('checks');
  });
});
