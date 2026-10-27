import { PROTOCOL_LIMITS } from '@shinsa/core';
import { type CheckRun, tailOutput } from './index.ts';

const TIMING = /\[?\b\d+(?:\.\d+)?\s?(?:ms|s)\b\]?/g;

const RAN_BY_SHINSA = "Shinsa ran these in the task's worktree after the agent's work.";

export interface CheckEvidenceText {
  title: string;
  detail: string;
  text: string;
}

function listOutputLines(text: string) {
  return text
    .replace(TIMING, '')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0);
}

function isAttachedAlready(output: string, attached: readonly Set<string>[]) {
  const lines = listOutputLines(output);
  if (lines.length === 0) return false;
  return attached.some((seen) => lines.every((line) => seen.has(line)));
}

function serializeCheckRun({ check, output }: CheckRun) {
  if (check.outcome === 'fail') return `$ ${check.name}\nFailed.\n${check.detail ?? ''}`.trim();
  return `$ ${check.name}\nPassed.\n${tailOutput(output) || 'No output.'}`;
}

function resolveTitle(runs: readonly CheckRun[]) {
  const failed = runs.filter((run) => run.check.outcome === 'fail').length;
  if (failed > 0) return `Checks run by Shinsa: ${failed} of ${runs.length} failed`;
  return `Checks run by Shinsa: ${runs.length === 1 ? '1 passed' : `all ${runs.length} passed`}`;
}

function resolveDetail(skipped: readonly CheckRun[]) {
  if (skipped.length === 0) return RAN_BY_SHINSA;
  const names = skipped.map((run) => run.check.name).join(', ');
  return `${RAN_BY_SHINSA} Left out ${names}: an agent attached the same output.`.slice(
    0,
    PROTOCOL_LIMITS.evidenceDetail
  );
}

function boundText(text: string) {
  const limit = PROTOCOL_LIMITS.evidenceText;
  return text.length <= limit ? text : `…\n${text.slice(-(limit - 2))}`;
}

export function serializeCheckEvidence(
  runs: readonly CheckRun[],
  attachedTexts: readonly string[]
): CheckEvidenceText | null {
  const attached = attachedTexts.map((text) => new Set(listOutputLines(text)));
  const kept = runs.filter((run) => !isAttachedAlready(run.output, attached));
  if (kept.length === 0) return null;
  return {
    title: resolveTitle(kept),
    detail: resolveDetail(runs.filter((run) => !kept.includes(run))),
    text: boundText(kept.map(serializeCheckRun).join('\n\n')),
  };
}
