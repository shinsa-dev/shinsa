import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileFeedbackIssue, parseIssueUrl, serializeFeedbackBody } from '../../src/feedback/file.ts';
import { createTempDir, overrideEnv } from '../helpers/index.ts';

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

function useFakeGitHub(extra: Record<string, unknown> = {}) {
  const path = join(createTempDir(), 'gh.json');
  writeFileSync(path, JSON.stringify({ next: 1, defaultChecks: 'pending', pulls: [], calls: [], ...extra }));
  restore = overrideEnv({ FAKE_GH_STATE: path });
  return {
    read: () =>
      JSON.parse(readFileSync(path, 'utf8')) as {
        issues?: { repo: string; title: string; body: string }[];
        calls: string[][];
      },
  };
}

describe('opening a feedback issue', () => {
  test('creates the issue on shinsa-dev/shinsa with the body on stdin and reads its link', async () => {
    const github = useFakeGitHub();
    const filing = await fileFeedbackIssue(
      { source: 'agent', title: '--Plan tab hides changes', body: 'The plan tab hides them.' },
      createTempDir()
    );
    expect(filing).toEqual({
      ok: true,
      issue: { number: 1, url: 'https://github.com/shinsa-dev/shinsa/issues/1' },
    });
    expect(github.read().issues).toEqual([
      {
        number: 1,
        repo: 'shinsa-dev/shinsa',
        title: '--Plan tab hides changes',
        body: serializeFeedbackBody({ source: 'agent', title: '', body: 'The plan tab hides them.' }),
      },
    ] as never);
    expect(github.read().calls[0]).toContain('--title=--Plan tab hides changes');
  });

  test('ends the body with a line that says where it came from', () => {
    expect(serializeFeedbackBody({ source: 'human', title: 'T', body: 'Body.' })).toBe(
      'Body.\n\n---\n_Sent from the feedback button in Shinsa._\n'
    );
    expect(serializeFeedbackBody({ source: 'agent', title: 'T', body: 'Body.' })).toContain(
      'Reported by an agent working in Shinsa'
    );
  });

  test('reports what gh said when it fails, and a reply without a link', async () => {
    useFakeGitHub({ failIssues: 'To get started with GitHub CLI, please run: gh auth login' });
    const failed = await fileFeedbackIssue({ source: 'human', title: 'T', body: 'B' }, createTempDir());
    expect(failed).toEqual({
      ok: false,
      detail: 'gh issue create failed: To get started with GitHub CLI, please run: gh auth login',
    });
    expect(parseIssueUrl('Created.')).toBeNull();
    expect(
      parseIssueUrl('https://github.com/a/b/issues/3\nhttps://github.com/shinsa-dev/shinsa/issues/12')
    ).toEqual({ number: 12, url: 'https://github.com/shinsa-dev/shinsa/issues/12' });
  });
});
