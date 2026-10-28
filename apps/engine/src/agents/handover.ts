import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  type ComparisonHandOver,
  type EvidencePart,
  type PieceHandOver,
  type Run,
  type Task,
  validateEvidence,
} from '@shinsa/core';
import type { EvidenceFolder } from '../store/evidence.ts';
import type { EvidenceStore } from '../store/index.ts';

export const HANDED_OVER =
  'Handed over: the human reads it in the chat as your reply. Stop here and write nothing more: never point at it, repeat or summarise it, and never say your turn is over.';

const COMMIT_TYPES = /^(feat|fix|chore|refactor|docs|perf|test)$/;

const FIX_COMMIT: Record<NonNullable<Task['fixFor']>, string> = {
  checks: 'make the checks pass',
  review: 'address review findings',
  you: 'apply requested changes',
  pull_request: 'address pull request feedback',
  conflict: 'resolve conflicts',
};

const SUBJECT_LIMIT = 72;

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

const VIDEO = /\.(mp4|webm|mov)$/i;

function resolveSourcePath(path: string, worktreePath: string | null) {
  return isAbsolute(path) || !worktreePath ? path : resolve(worktreePath, path);
}

function resolveEvidenceUri(
  { kind, source, title }: PieceHandOver,
  worktreePath: string | null,
  evidence: EvidenceStore,
  folder: EvidenceFolder
) {
  if ('path' in source) return evidence.copyFile(resolveSourcePath(source.path, worktreePath), folder, title);
  if ('url' in source) {
    if (!isWebUrl(source.url)) throw new Error('url must be an http or https address.');
    return source.url;
  }
  return evidence.writeText(source.text, folder, title, kind === 'note' ? 'md' : 'txt');
}

function storeComparison(
  { parts, kind: _kind, ...facts }: ComparisonHandOver,
  worktreePath: string | null,
  evidence: EvidenceStore,
  folder: EvidenceFolder
) {
  const resolved = parts.map((part) => ({ ...part, path: resolveSourcePath(part.path, worktreePath) }));
  const missing = resolved.find((part) => !existsSync(part.path));
  if (missing) throw new Error(`No file at ${missing.path}.`);
  const stored = resolved.map(
    ({ path, stage, label }): EvidencePart => ({
      kind: VIDEO.test(path) ? 'recording' : 'screenshot',
      uri: evidence.copyFile(path, folder, `${facts.title} ${label ?? stage}`),
      stage,
      label,
    })
  );
  return { type: 'agent.attach_comparison' as const, ...facts, parts: stored };
}

export function storeEvidence(
  input: Record<string, unknown>,
  worktreePath: string | null,
  evidence: EvidenceStore,
  folder: EvidenceFolder
) {
  const result = validateEvidence(input);
  if (!result.ok) {
    throw new Error(
      `Shinsa did not attach it. Fix these and call \`attach_evidence\` again:\n${result.errors.map((error) => `- ${error}`).join('\n')}`
    );
  }
  const handOver = result.value;
  if ('check' in handOver) {
    const { kind, check, detail } = handOver;
    return { type: 'agent.attach_check' as const, kind, checkId: check, detail };
  }
  if (handOver.kind === 'comparison') return storeComparison(handOver, worktreePath, evidence, folder);
  const { source: _source, ...fields } = handOver;
  const uri = resolveEvidenceUri(handOver, worktreePath, evidence, folder);
  return { type: 'agent.attach_evidence' as const, ...fields, uri };
}
