import { describe, expect, test } from 'bun:test';
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
    expect(resolveCommitMessage(task, { role: 'builder', phaseIndex: 0 } as Run)).toBe(
      'fix: find the overflow'
    );
  });

  test('a phase title that starts with the commit type does not repeat it', () => {
    const fixTask = {
      ...task,
      plan: { document: { phases: [{ title: 'Fix add() and empty average()', detail: '' }] } },
    } as unknown as Task;
    expect(resolveCommitMessage(fixTask, { role: 'builder', phaseIndex: 0 } as Run)).toBe(
      'fix: add() and empty average()'
    );
  });

  test('a fix commits with what it fixed', () => {
    expect(resolveCommitMessage(task, { role: 'fixer' } as Run)).toBe('fix: make the checks pass');
  });
});

describe('commit messages', () => {
  test('a branch without a known type commits as feat, and a task without a plan uses its title', () => {
    const plain = { title: 'Add search', branch: 'search', spec: null, fixFor: null } as unknown as Task;
    expect(resolveCommitMessage(plain, { role: 'builder', phaseIndex: null } as Run)).toBe(
      'feat: add search'
    );
    expect(resolveCommitMessage({ ...plain, branch: null } as Task, { role: 'builder' } as Run)).toBe(
      'feat: add search'
    );
    expect(resolveCommitMessage(plain, { role: 'fixer' } as Run)).toBe('fix: apply requested changes');
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

describe('storeEvidence', () => {
  test('a relative path is read from the worktree, not from where Shinsa runs', () => {
    const worktree = createTempDir();
    writeFiles(worktree, { 'shots/home.png': 'png' });
    const evidence = new EvidenceStore(createTempDir());
    const stored = storeEvidence(
      { kind: 'screenshot', title: 'Home', path: 'shots/home.png' },
      worktree,
      evidence
    );
    expect(stored).toMatchObject({ kind: 'screenshot', title: 'Home' });
    expect(stored.uri).toMatch(/^\/api\/evidence\/.+\.png$/);
    expect(storeEvidence({ path: join(worktree, 'shots/home.png') }, null, evidence)).toMatchObject({
      kind: 'note',
      title: 'note',
    });
  });

  test('a URL must be a web address and text is written to a file', () => {
    const evidence = new EvidenceStore(createTempDir());
    expect(
      storeEvidence({ kind: 'preview', title: 'Preview', url: 'https://preview.dev' }, null, evidence).uri
    ).toBe('https://preview.dev');
    expect(() => storeEvidence({ url: 'javascript:alert(1)' }, null, evidence)).toThrow('http or https');
    expect(() => storeEvidence({ url: 'not a url' }, null, evidence)).toThrow('http or https');
    expect(storeEvidence({ kind: 'test', text: '12 pass' }, null, evidence).uri).toMatch(/\.txt$/);
  });

  test('an unknown kind or nothing to attach is refused', () => {
    const evidence = new EvidenceStore(createTempDir());
    expect(() => storeEvidence({ kind: 'virus', text: 'x' }, null, evidence)).toThrow('kind must be one of');
    expect(() => storeEvidence({ kind: 'note' }, null, evidence)).toThrow('Give a path, a url or text.');
  });
});
