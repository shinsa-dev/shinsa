import { FEEDBACK_REPOSITORY, type FeedbackIssue, type FeedbackSource } from '@shinsa/core';
import { GITHUB_TIMEOUT_MS } from '../github/index.ts';
import { describeFailure, runCommand } from '../shell/index.ts';

export interface FeedbackIssueInput {
  source: FeedbackSource;
  title: string;
  body: string;
}

type FiledIssue = Pick<FeedbackIssue, 'number' | 'url'>;

export type FeedbackFiling = { ok: true; issue: FiledIssue } | { ok: false; detail: string };

const ISSUE_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/(\d+)/g;

const FOOTERS: Record<FeedbackSource, string> = {
  human: 'Sent from the feedback button in Shinsa.',
  agent: 'Reported by an agent working in Shinsa, then read and sent by the person it works for.',
};

export function serializeFeedbackBody(input: FeedbackIssueInput) {
  return `${input.body}\n\n---\n_${FOOTERS[input.source]}_\n`;
}

export function parseIssueUrl(output: string): FiledIssue | null {
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

export type FeedbackIssueStates = Map<number, number | null>;

interface ListedIssue {
  number?: unknown;
  state?: unknown;
  closedAt?: unknown;
}

const ISSUE_LIST_LIMIT = 500;

function readClosedAt(issue: ListedIssue) {
  if (issue.state !== 'CLOSED' || typeof issue.closedAt !== 'string') return null;
  const closedAt = Date.parse(issue.closedAt);
  return Number.isNaN(closedAt) ? null : closedAt;
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

export function parseIssueStates(output: string): FeedbackIssueStates | null {
  const listed = parseJson(output);
  if (!Array.isArray(listed)) return null;
  const states: FeedbackIssueStates = new Map();
  for (const issue of listed as ListedIssue[]) {
    if (typeof issue.number === 'number') states.set(issue.number, readClosedAt(issue));
  }
  return states;
}

export async function listFeedbackIssueStates(cwd: string, signal?: AbortSignal) {
  const command = [
    'gh',
    'issue',
    'list',
    '--repo',
    FEEDBACK_REPOSITORY,
    '--author',
    '@me',
    '--state',
    'all',
    '--limit',
    String(ISSUE_LIST_LIMIT),
    '--json',
    'number,state,closedAt',
  ];
  const result = await runCommand(command, cwd, { signal, timeoutMs: GITHUB_TIMEOUT_MS });
  if (!result.ok) return { ok: false as const, detail: describeFailure(command, result) };
  const states = parseIssueStates(result.stdout);
  if (!states)
    return { ok: false as const, detail: `GitHub answered without a list of issues: ${result.stdout}` };
  return { ok: true as const, states };
}
