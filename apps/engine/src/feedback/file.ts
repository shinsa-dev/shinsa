import { FEEDBACK_REPOSITORY, type FeedbackIssue, type FeedbackSource } from '@shinsa/core';
import { GITHUB_TIMEOUT_MS } from '../github/index.ts';
import { describeFailure, runCommand } from '../shell/index.ts';

export interface FeedbackIssueInput {
  source: FeedbackSource;
  title: string;
  body: string;
}

export type FeedbackFiling = { ok: true; issue: FeedbackIssue } | { ok: false; detail: string };

const ISSUE_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/(\d+)/g;

const FOOTERS: Record<FeedbackSource, string> = {
  human: 'Sent from the feedback button in Shinsa.',
  agent: 'Reported by an agent working in Shinsa, then read and sent by the person it works for.',
};

export function serializeFeedbackBody(input: FeedbackIssueInput) {
  return `${input.body}\n\n---\n_${FOOTERS[input.source]}_\n`;
}

export function parseIssueUrl(output: string): FeedbackIssue | null {
  const found = [...output.matchAll(ISSUE_URL)].at(-1);
  return found?.[1] ? { number: Number(found[1]), url: found[0] } : null;
}

export async function fileFeedbackIssue(
  input: FeedbackIssueInput,
  cwd: string,
  signal?: AbortSignal
): Promise<FeedbackFiling> {
  const command = [
    'gh',
    'issue',
    'create',
    '--repo',
    FEEDBACK_REPOSITORY,
    `--title=${input.title}`,
    '--body-file',
    '-',
  ];
  const result = await runCommand(command, cwd, {
    input: serializeFeedbackBody(input),
    signal,
    timeoutMs: GITHUB_TIMEOUT_MS,
  });
  if (!result.ok) return { ok: false, detail: describeFailure(command, result) };
  const issue = parseIssueUrl(result.stdout);
  if (!issue) return { ok: false, detail: `GitHub answered without the new issue’s link: ${result.stdout}` };
  return { ok: true, issue };
}
