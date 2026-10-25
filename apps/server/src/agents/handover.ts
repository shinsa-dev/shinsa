import { isAbsolute, resolve } from 'node:path';
import type { EvidenceKind, Run, Task } from '@shinsa/core';
import type { EvidenceStore } from '../store/index.ts';

export const HANDED_OVER =
  'Handed over: the human reads it in the chat as your reply. Stop here and write nothing more: never point at it, repeat or summarise it, and never say your turn is over.';

const EVIDENCE_KINDS = new Set<EvidenceKind>(['screenshot', 'recording', 'test', 'check', 'note', 'preview']);

const COMMIT_TYPES = /^(feat|fix|chore|refactor|docs|perf|test)$/;

const FIX_COMMIT: Record<NonNullable<Task['fixFor']>, string> = {
  checks: 'make the checks pass',
  review: 'address review findings',
  you: 'apply requested changes',
  pull_request: 'address pull request feedback',
  conflict: 'resolve conflicts',
};

const SUBJECT_LIMIT = 72;

interface EvidenceHandOver {
  kind: EvidenceKind;
  title: string;
  uri: string;
}

export function readString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function assertProtocol<T>(result: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (result.ok) return result.value;
  throw new Error(
    `Shinsa rejected this hand-over. Fix these and call the tool again:\n${result.errors.map((error) => `- ${error}`).join('\n')}`
  );
}

function resolveCommitType(task: Task) {
  const prefix = task.branch?.split('/')[0] ?? '';
  return COMMIT_TYPES.test(prefix) ? prefix : 'feat';
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function resolveCommitMessage(task: Task, run: Run) {
  if (run.purpose !== 'build') return `fix: ${FIX_COMMIT[task.fixFor ?? 'you']}`;
  const type = resolveCommitType(task);
  const step = task.plan?.document?.phases[run.phaseIndex ?? 0];
  const subject = lowerFirst(step?.title ?? task.title).replace(new RegExp(`^${type}(es)?\\s+`), '');
  return `${type}: ${subject}`.slice(0, SUBJECT_LIMIT);
}

function isWebUrl(url: string) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function storeEvidence(
  input: Record<string, unknown>,
  worktreePath: string | null,
  evidence: EvidenceStore
): EvidenceHandOver {
  const kind = (readString(input, 'kind') ?? 'note') as EvidenceKind;
  if (!EVIDENCE_KINDS.has(kind)) throw new Error(`kind must be one of ${[...EVIDENCE_KINDS].join(', ')}.`);
  const title = readString(input, 'title') ?? kind;
  const path = readString(input, 'path');
  const url = readString(input, 'url');
  const text = readString(input, 'text');
  if (path) {
    const source = isAbsolute(path) || !worktreePath ? path : resolve(worktreePath, path);
    return { kind, title, uri: evidence.copyFile(source) };
  }
  if (url) {
    if (!isWebUrl(url)) throw new Error('url must be an http or https address.');
    return { kind, title, uri: url };
  }
  if (text) return { kind, title, uri: evidence.writeText(text) };
  throw new Error('Give a path, a url or text.');
}
