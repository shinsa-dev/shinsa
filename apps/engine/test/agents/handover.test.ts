import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Run, Task } from '@shinsa/core';
import {
  assertProtocol,
  HANDED_OVER,
  resolveCommitMessage,
  storeEvidence,
} from '../../src/agents/handover.ts';
import { EvidenceStore } from '../../src/store/index.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

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

describe('assertProtocol', () => {
  test('passes a valid hand-over and lists every problem of an invalid one', () => {
    expect(assertProtocol({ ok: true, value: 3 })).toBe(3);
    expect(() => assertProtocol({ ok: false, errors: ['goal is empty', 'plan is too long'] })).toThrow(
      'Shinsa rejected this hand-over. Fix these and call the tool again:\n- goal is empty\n- plan is too long'
    );
  });
});

const FOLDER = { taskId: 'task-1', round: 2 };

describe('storeEvidence', () => {
  test('a relative path is read from the worktree into the task and round folder, with its facts', () => {
    const worktree = createTempDir();
    writeFiles(worktree, { 'shots/home.png': 'png' });
    const evidence = new EvidenceStore(createTempDir());
    const stored = storeEvidence(
      {
        kind: 'screenshot',
        title: 'Home page',
        path: 'shots/home.png',
        detail: 'The header wraps.',
        width: 390,
        theme: 'dark',
        stage: 'after',
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
      stage: 'after',
      uri: expect.stringMatching(/^\/api\/evidence\/task-1\/round-2\/home-page-\w+\.png$/),
    });
    expect(
      storeEvidence(
        { kind: 'note', title: 'Home', path: join(worktree, 'shots/home.png') },
        null,
        evidence,
        FOLDER
      )
    ).toMatchObject({ kind: 'note', title: 'Home', detail: null, width: null });
  });

  test('a URL must be a web address, text is written to a file and a note to a markdown file', () => {
    const evidence = new EvidenceStore(createTempDir());
    expect(
      storeEvidence({ kind: 'preview', title: 'Preview', url: 'https://preview.dev' }, null, evidence, FOLDER)
    ).toMatchObject({ uri: 'https://preview.dev' });
    expect(() =>
      storeEvidence({ kind: 'preview', title: 'P', url: 'javascript:alert(1)' }, null, evidence, FOLDER)
    ).toThrow('http or https');
    expect(() =>
      storeEvidence({ kind: 'preview', title: 'P', url: 'not a url' }, null, evidence, FOLDER)
    ).toThrow('http or https');
    expect(
      storeEvidence({ kind: 'test', title: 'Tests', text: '12 pass' }, null, evidence, FOLDER)
    ).toMatchObject({ uri: expect.stringMatching(/\/round-2\/tests-\w+\.txt$/) });
    expect(
      storeEvidence({ kind: 'note', title: 'Ratios', text: '| a | b |' }, null, evidence, FOLDER)
    ).toMatchObject({ uri: expect.stringMatching(/\/round-2\/ratios-\w+\.md$/) });
  });

  test('a comparison copies each part, a video as a recording, and names each file by its part', () => {
    const worktree = createTempDir();
    writeFiles(worktree, { 'before.png': 'png', 'after.webm': 'webm' });
    const evidence = new EvidenceStore(createTempDir());
    const stored = storeEvidence(
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

  test('a comparison with a missing part copies none of them', () => {
    const worktree = createTempDir();
    writeFiles(worktree, { 'before.png': 'png' });
    const dir = createTempDir();
    const parts = [
      { path: 'before.png', stage: 'before' },
      { path: 'gone.png', stage: 'after' },
    ];
    expect(() =>
      storeEvidence({ kind: 'comparison', title: 'Tabs', parts }, worktree, new EvidenceStore(dir), FOLDER)
    ).toThrow(`No file at ${join(worktree, 'gone.png')}.`);
    expect(readdirSync(dir)).toEqual([]);
  });

  test('a hand-over that breaks the protocol is refused with every reason', () => {
    const evidence = new EvidenceStore(createTempDir());
    expect(() => storeEvidence({ kind: 'virus', text: 'x' }, null, evidence, FOLDER)).toThrow(
      'Shinsa did not attach it. Fix these and call `attach_evidence` again:\n- kind must be one of screenshot, recording, test, check, note, preview, comparison.\n- title is required.'
    );
    expect(() => storeEvidence({ kind: 'note', title: 'Nothing' }, null, evidence, FOLDER)).toThrow(
      'Give exactly one of path, url or text.'
    );
  });
});
