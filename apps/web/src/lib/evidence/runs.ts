import type { EvidenceKind } from '@shinsa/core';

type EvidenceRunOutcome = 'pass' | 'fail' | null;

export interface EvidenceRun {
  command: string;
  outcome: EvidenceRunOutcome;
  counts: string | null;
}

const COMMAND = /^\$\s+(.+)$/;

const VERDICT = /^(passed|failed)\.?$/i;

const BUN_COUNT = /^(\d+) (pass|fail)$/;

const SUMMARY_COUNT = /\b(\d+) (passed|failed)\b/g;

export function isRunEvidence(kind: EvidenceKind) {
  return kind === 'test' || kind === 'check';
}

function splitRuns(text: string) {
  const blocks: { command: string; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const command = COMMAND.exec(line)?.[1];
    const last = blocks.at(-1);
    if (command) blocks.push({ command, lines: [] });
    else if (last) last.lines.push(line);
    else if (line) blocks.push({ command: line, lines: [] });
  }
  return blocks;
}

function countOutcomes(lines: readonly string[]) {
  const counts: { pass: number | null; fail: number | null } = { pass: null, fail: null };
  const add = (word: string, value: number) => {
    const key = word.startsWith('pass') ? 'pass' : 'fail';
    counts[key] = (counts[key] ?? 0) + value;
  };
  for (const line of lines) {
    const bun = BUN_COUNT.exec(line);
    if (bun) {
      add(bun[2] as string, Number(bun[1]));
      continue;
    }
    for (const match of line.matchAll(SUMMARY_COUNT)) add(match[2] as string, Number(match[1]));
  }
  return counts;
}

function resolveOutcome(verdict: string | undefined, pass: number, fail: number): EvidenceRunOutcome {
  if (verdict) return verdict === 'failed' ? 'fail' : 'pass';
  if (fail > 0) return 'fail';
  return pass > 0 ? 'pass' : null;
}

function resolveRun({ command, lines }: { command: string; lines: string[] }): EvidenceRun {
  const verdict = lines.map((line) => VERDICT.exec(line)?.[1]?.toLowerCase()).find(Boolean);
  const { pass, fail } = countOutcomes(lines);
  const counted = pass !== null || fail !== null;
  return {
    command,
    outcome: resolveOutcome(verdict, pass ?? 0, fail ?? 0),
    counts: counted ? `${pass ?? 0} pass, ${fail ?? 0} fail` : null,
  };
}

export function listEvidenceRuns(text: string): EvidenceRun[] {
  return splitRuns(text).map(resolveRun);
}

export function describeRunToggle(open: boolean) {
  return open ? 'Hide the output' : 'Show the output';
}
