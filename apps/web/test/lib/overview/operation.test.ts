import { describe, expect, it } from 'bun:test';
import type { Gate } from '@shinsa/core';
import {
  describeOperationIntro,
  OPERATION_SKIP,
  resolveMergedCommit,
  resolveOperationBody,
  resolveOperationRun,
} from '@/lib/overview/operation.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { createGate, createTask } from '../../support/state.ts';

const SHA = '9f2c4e1b7a3d5e60c8f1a2b3c4d5e6f708192a3b';

const BODY = [
  'Pull request #318 merged as `9f2c4e1`. The merged code can differ from the plan you approved, so check it before the operation runs.',
  '',
  '## Operation',
  '1. Run the dry run.',
  '2. Run it for real.',
  '',
  '## Impact',
  'About 12,400 rows.',
].join('\n');

function gate(overrides: Partial<Gate> = {}) {
  return createGate({
    id: 'g',
    taskId: 't',
    type: 'operation',
    body: BODY,
    ...overrides,
  });
}

describe('resolveMergedCommit', () => {
  it('takes the gate’s commit, short for the chip and whole for copying', () => {
    expect(resolveMergedCommit(createTask({ id: 't' }), gate({ commit: SHA }))).toEqual({
      full: SHA,
      short: '9f2c4e1',
    });
  });

  it('falls back to the pull request’s merge commit, and is null when neither knows it', () => {
    const merged = createTask({
      id: 't',
      pullRequest: createPullRequest({ number: 318, state: 'merged', mergeCommit: SHA }),
    });
    expect(resolveMergedCommit(merged, gate())?.short).toBe('9f2c4e1');
    expect(resolveMergedCommit(createTask({ id: 't' }), gate({ commit: null }))).toBeNull();
  });
});

describe('the operation gate’s body', () => {
  it('keeps the caution and leaves the merge sentence to the merged line when there is one', () => {
    expect(resolveOperationBody(gate(), true)).toEqual({
      caution:
        'The merged code can differ from the plan you approved, so check it before the operation runs.',
      rest: '## Operation\n1. Run the dry run.\n2. Run it for real.\n\n## Impact\nAbout 12,400 rows.',
    });
  });

  it('keeps the whole intro when nothing else shows the merge, and has no rest without headings', () => {
    expect(resolveOperationBody(gate({ body: 'The change merged.' }), false)).toEqual({
      caution: 'The change merged.',
      rest: '',
    });
  });

  it('reads the intro as plain text for a notification', () => {
    expect(describeOperationIntro(gate())).toBe(
      'Pull request #318 merged as 9f2c4e1. The merged code can differ from the plan you approved, so check it before the operation runs.'
    );
  });

  it('asks before finishing without the operation, since it ends the task', () => {
    expect(OPERATION_SKIP).toEqual({
      title: 'Finish without running the operation?',
      body: 'The change stays merged and the task is done. The operation does not run.',
      action: 'Finish without it',
    });
  });

  it('runs with the saved notes when the box still holds them', () => {
    expect(resolveOperationRun({ notes: 'Skip the archive.' }, '  Skip the archive. ')).toEqual({
      reply: 'runOperation',
      response: null,
    });
    expect(resolveOperationRun({ notes: null }, '   ')).toEqual({ reply: 'runOperation', response: null });
  });

  it('replaces the notes with the box’s text when it changed', () => {
    expect(resolveOperationRun({ notes: 'Skip the archive.' }, ' Watch the error rate. ')).toEqual({
      reply: 'runOperationWithNotes',
      response: 'Watch the error rate.',
    });
    expect(resolveOperationRun({ notes: null }, 'Watch the error rate.')).toEqual({
      reply: 'runOperationWithNotes',
      response: 'Watch the error rate.',
    });
  });

  it('clears the notes when the box was emptied', () => {
    expect(resolveOperationRun({ notes: 'Skip the archive.' }, '  ')).toEqual({
      reply: 'runOperationWithoutNotes',
      response: '',
    });
  });
});
