import { isAbsolute, resolve } from 'node:path';
import {
  type ComparisonHandOver,
  type EvidencePart,
  type PieceHandOver,
  validateEvidence,
} from '@shinsa/core';
import { Effect } from 'effect';
import { isPresent } from '../files/probe.ts';
import type { EvidenceFolder } from '../store/evidence/index.ts';
import type { Evidence } from '../store/evidence/service.ts';
import { ToolCallFailed } from './tools/schema.ts';

function isWebUrl(url: string) {
  if (!URL.canParse(url)) return false;
  const { protocol } = new URL(url);
  return protocol === 'http:' || protocol === 'https:';
}

const VIDEO = /\.(mp4|webm|mov)$/i;

function resolveSourcePath(path: string, worktreePath: string | null) {
  return isAbsolute(path) || !worktreePath ? path : resolve(worktreePath, path);
}

function resolveEvidenceUri(
  { kind, source, title }: PieceHandOver,
  worktreePath: string | null,
  evidence: Evidence['Service'],
  folder: EvidenceFolder
) {
  if ('path' in source) return evidence.copyFile(resolveSourcePath(source.path, worktreePath), folder, title);
  if ('url' in source) {
    if (!isWebUrl(source.url))
      return Effect.fail(new ToolCallFailed({ message: 'url must be an http or https address.' }));
    return Effect.succeed(source.url);
  }
  return evidence.writeText(source.text, folder, title, kind === 'note' ? 'md' : 'txt');
}

const storeComparison = Effect.fn('storeComparison')(function* (
  { parts, kind: _kind, ...facts }: ComparisonHandOver,
  worktreePath: string | null,
  evidence: Evidence['Service'],
  folder: EvidenceFolder
) {
  const resolved = parts.map((part) => ({ ...part, path: resolveSourcePath(part.path, worktreePath) }));
  for (const part of resolved)
    if (!(yield* isPresent(part.path)))
      return yield* new ToolCallFailed({ message: `No file at ${part.path}.` });
  const stored = yield* Effect.forEach(resolved, ({ path, stage, label }) =>
    Effect.map(evidence.copyFile(path, folder, `${facts.title} ${label ?? stage}`), (uri): EvidencePart => ({
      kind: VIDEO.test(path) ? 'recording' : 'screenshot',
      uri,
      stage,
      label,
    }))
  );
  return { type: 'agent.attach_comparison' as const, ...facts, parts: stored };
});

export const storeEvidence = Effect.fn('storeEvidence')(function* (
  input: Record<string, unknown>,
  worktreePath: string | null,
  evidence: Evidence['Service'],
  folder: EvidenceFolder
) {
  const result = validateEvidence(input);
  if (!result.ok) {
    return yield* new ToolCallFailed({
      message: `Shinsa did not attach it. Fix these and call \`attach_evidence\` again:\n${result.errors.map((error) => `- ${error}`).join('\n')}`,
    });
  }
  const handOver = result.value;
  if ('check' in handOver) {
    const { kind, check, detail, replaces } = handOver;
    return { type: 'agent.attach_check' as const, kind, checkId: check, detail, replaces };
  }
  if (handOver.kind === 'comparison') return yield* storeComparison(handOver, worktreePath, evidence, folder);
  const { source: _source, ...fields } = handOver;
  const uri = yield* resolveEvidenceUri(handOver, worktreePath, evidence, folder);
  return { type: 'agent.attach_evidence' as const, ...fields, uri };
});
