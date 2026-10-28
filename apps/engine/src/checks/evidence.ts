import { type CheckNote, PROTOCOL_LIMITS } from '@shinsa/core';
import { type CheckRun, tailOutput } from './index.ts';

const NOTE_LINES: Record<CheckNote, string> = {
  passed_alone: 'Passed when the failing test files were re-run alone.',
  fails_on_base: 'Failed, and fails on the base commit too.',
};

function describeOutcome({ check }: CheckRun) {
  if (check.note) return NOTE_LINES[check.note];
  return check.outcome === 'pass' ? 'Passed.' : 'Failed.';
}

function boundText(text: string) {
  const limit = PROTOCOL_LIMITS.evidenceText;
  return text.length <= limit ? text : `…\n${text.slice(-(limit - 2))}`;
}

export function serializeCheckOutput(run: CheckRun) {
  const lines = [`$ ${run.check.command}`, describeOutcome(run)];
  if (run.check.outcome === 'fail' && run.check.detail) lines.push(run.check.detail);
  else lines.push(tailOutput(run.output) || 'No output.');
  return boundText(lines.join('\n'));
}
