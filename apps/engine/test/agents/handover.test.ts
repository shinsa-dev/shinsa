import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Run, Task } from '@shinsa/core';
import { Result } from 'effect';
import { storeEvidence as storeEvidenceEffect } from '../../src/agents/evidence.ts';
import {
  assertHeldSourcesUsed,
  HANDED_OVER,
  resolveCommitMessage,
  resolveHandOver,
} from '../../src/agents/handover.ts';
import { runFiles } from '../harness.ts';
import { createTestEvidence } from '../helpers/evidence.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

const storeEvidence = (...args: Parameters<typeof storeEvidenceEffect>) =>
  runFiles(storeEvidenceEffect(...args));

describe('commits', () => {
  const task = {
    title: 'Fix tab scroll',
    branch: 'fix/tab-scroll',
    fixFor: 'checks',
    plan: { document: { phases: [{ title: 'Find the overflow', detail: '' }] } },
  } as unknown as Task;

  test('a phase commits under the branch type with the phase title', () => {
    expect(resolveCommitMessage(task, { role: 'agent', purpose: 'build', phaseIndex: 0 } as Run)).toBe(
      'fix: find the overflow'
    );
  });

  test('a phase title that starts with the commit type does not repeat it', () => {
    const fixTask = {
      ...task,
      plan: { document: { phases: [{ title: 'Fix add() and empty average()', detail: '' }] } },
    } as unknown as Task;
    expect(resolveCommitMessage(fixTask, { role: 'agent', purpose: 'build', phaseIndex: 0 } as Run)).toBe(
      'fix: add() and empty average()'
    );
  });

  test('a fix, or any hand-over that is not a phase, commits with what it fixed', () => {
    expect(resolveCommitMessage(task, { role: 'agent', purpose: 'fix' } as Run)).toBe(
      'fix: make the checks pass'
    );
    expect(resolveCommitMessage(task, { role: 'agent', purpose: 'operate' } as Run)).toBe(
      'fix: make the checks pass'
    );
  });
});

describe('commit messages', () => {
  test('a branch without a known type commits as feat, and a task without a plan uses its title', () => {
    const plain = { title: 'Add search', branch: 'search', spec: null, fixFor: null } as unknown as Task;
    expect(resolveCommitMessage(plain, { role: 'agent', purpose: 'build', phaseIndex: null } as Run)).toBe(
      'feat: add search'
    );
    expect(
      resolveCommitMessage({ ...plain, branch: null } as Task, { role: 'agent', purpose: 'build' } as Run)
    ).toBe('feat: add search');
    expect(resolveCommitMessage(plain, { role: 'agent', purpose: 'fix' } as Run)).toBe(
      'fix: apply requested changes'
    );
  });
});

describe('the reply to a hand-over', () => {
  test('tells the agent the hand-over is its reply and to stop without pointing at it or its turn ending', () => {
    expect(HANDED_OVER).toContain('the human reads it in the chat as your reply.');
    expect(HANDED_OVER).toContain('Stop here and write nothing more');
    expect(HANDED_OVER).toContain('never point at it, repeat or summarise it');
    expect(HANDED_OVER).toContain('never say your turn is over');
    expect(HANDED_OVER).not.toContain('Shinsa');
    expect(HANDED_OVER).not.toContain('sees this');
  });
});

describe('resolveHandOver', () => {
  test('passes a valid hand-over and lists every problem of an invalid one', () => {
    expect(resolveHandOver({ ok: true, value: 3 })).toEqual(Result.succeed(3));
    expect(
      Result.flip(resolveHandOver({ ok: false, errors: ['goal is empty', 'plan is too long'] }))
    ).toMatchObject({
      success: {
        _tag: 'HandOverRejected',
        errors: ['goal is empty', 'plan is too long'],
        message:
          'Shinsa rejected this hand-over. Fix these and call the tool again:\n- goal is empty\n- plan is too long',
      },
    });
  });

  test('passes when no watchdog asks for a source', () => {
    expect(Result.isSuccess(assertHeldSourcesUsed([], ['maple']))).toBe(true);
  });
});

const FOLDER = { taskId: 'task-1', round: 2 };

describe('storeEvidence', () => {
  test('a relative path is read from the worktree into the task and round folder, with its facts', async () => {
    const worktree = createTempDir();
    writeFiles(worktree, { 'shots/home.png': 'png' });
    const evidence = createTestEvidence(createTempDir());
    const stored = await storeEvidence(
      {
        kind: 'screenshot',
        title: 'Home page',
        path: 'shots/home.png',
        detail: 'The header wraps.',
        width: 390,
        theme: 'dark',
        stage: 'after',
        key: 'home-dark-390',
        replaces: ['home-old'],
      },
      worktree,
      evidence,
      FOLDER
    );
    expect(stored).toEqual({
      type: 'agent.attach_evidence',
      kind: 'screenshot',
      title: 'Home page',
      detail: 'The header wraps.',
      width: 390,
      theme: 'dark',
      key: 'home-dark-390',
      replaces: ['home-old'],
      stage: 'after',
      uri: expect.stringMatching(/^\/api\/evidence\/task-1\/round-2\/home-page-\w+\.png$/),
    });
    expect(
      await storeEvidence(
        { kind: 'note', title: 'Home', path: join(worktree, 'shots/home.png') },
        null,
        evidence,
        FOLDER
      )
    ).toMatchObject({ kind: 'note', title: 'Home', detail: null, width: null });
  });

  test('a URL must be a web address, text is written to a file and a note to a markdown file', async () => {
    const evidence = createTestEvidence(createTempDir());
    expect(
      await storeEvidence(
        { kind: 'preview', title: 'Preview', url: 'https://preview.dev' },
        null,
        evidence,
        FOLDER
      )
    ).toMatchObject({ uri: 'https://preview.dev' });
    await expect(
      storeEvidence({ kind: 'preview', title: 'P', url: 'javascript:alert(1)' }, null, evidence, FOLDER)
    ).rejects.toThrow('http or https');
    await expect(
      storeEvidence({ kind: 'preview', title: 'P', url: 'not a url' }, null, evidence, FOLDER)
    ).rejects.toThrow('http or https');
    expect(
      await storeEvidence({ kind: 'screenshot', title: 'Tests', text: '12 pass' }, null, evidence, FOLDER)
    ).toMatchObject({ uri: expect.stringMatching(/\/round-2\/tests-\w+\.txt$/) });
    expect(
      await storeEvidence({ kind: 'note', title: 'Ratios', text: '| a | b |' }, null, evidence, FOLDER)
    ).toMatchObject({ uri: expect.stringMatching(/\/round-2\/ratios-\w+\.md$/) });
  });

  test('a test or check links a check by id, and anything else given with it is refused', async () => {
    const evidence = createTestEvidence(createTempDir());
    expect(
      await storeEvidence(
        { kind: 'test', check: 'c2', detail: 'The new file is read.' },
        null,
        evidence,
        FOLDER
      )
    ).toEqual({
      type: 'agent.attach_check',
      kind: 'test',
      checkId: 'c2',
      detail: 'The new file is read.',
      replaces: [],
    });
    await expect(
      storeEvidence({ kind: 'check', check: 'c1', text: '12 pass' }, null, evidence, FOLDER)
    ).rejects.toThrow('leave out text');
  });

  test('a comparison copies each part, a video as a recording, and names each file by its part', async () => {
    const worktree = createTempDir();
    writeFiles(worktree, { 'before.png': 'png', 'after.webm': 'webm' });
    const evidence = createTestEvidence(createTempDir());
    const stored = await storeEvidence(
      {
        kind: 'comparison',
        title: 'Tabs',
        width: 1280,
        parts: [
          { path: 'before.png', stage: 'before' },
          { path: join(worktree, 'after.webm'), stage: 'after', label: 'Scrolled' },
        ],
      },
      worktree,
      evidence,
      FOLDER
    );
    expect(stored).toEqual({
      type: 'agent.attach_comparison',
      title: 'Tabs',
      detail: null,
      width: 1280,
      theme: null,
      key: null,
      replaces: [],
      parts: [
        {
          kind: 'screenshot',
          uri: expect.stringMatching(/\/round-2\/tabs-before-\w+\.png$/),
          stage: 'before',
          label: null,
        },
        {
          kind: 'recording',
          uri: expect.stringMatching(/\/round-2\/tabs-scrolled-\w+\.webm$/),
          stage: 'after',
          label: 'Scrolled',
        },
      ],
    });
  });

  test('a comparison with a missing part copies none of them', async () => {
    const worktree = createTempDir();
    writeFiles(worktree, { 'before.png': 'png' });
    const dir = createTempDir();
    const parts = [
      { path: 'before.png', stage: 'before' },
      { path: 'gone.png', stage: 'after' },
    ];
    await expect(
      storeEvidence({ kind: 'comparison', title: 'Tabs', parts }, worktree, createTestEvidence(dir), FOLDER)
    ).rejects.toThrow(`No file at ${join(worktree, 'gone.png')}.`);
    expect(readdirSync(dir)).toEqual([]);
  });

  test('a hand-over that breaks the protocol is refused with every reason', async () => {
    const evidence = createTestEvidence(createTempDir());
    await expect(storeEvidence({ kind: 'virus', text: 'x' }, null, evidence, FOLDER)).rejects.toThrow(
      'Shinsa did not attach it. Fix these and call `attach_evidence` again:\n- kind must be one of screenshot, recording, test, check, note, preview, comparison.\n- title is required.'
    );
    await expect(storeEvidence({ kind: 'note', title: 'Nothing' }, null, evidence, FOLDER)).rejects.toThrow(
      'Give exactly one of path, url or text.'
    );
  });
});
