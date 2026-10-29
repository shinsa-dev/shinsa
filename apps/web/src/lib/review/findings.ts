import {
  type Attention,
  type ChatToolArgs,
  FINDING_SEVERITIES,
  type FindingVerdictKind,
  type ReviewFinding,
} from '@shinsa/core';
import { readList, readString, resolveShortPath } from '@/lib/chat/tool-describe.ts';
import { formatCount } from '@/lib/format/count.ts';
import type { Tone } from '@/lib/format/tone.ts';

export type FindingPlace = Pick<ReviewFinding, 'file' | 'line' | 'end'>;

type Severity = ReviewFinding['severity'];

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocking: 'Blocking',
  should_fix: 'Should fix',
  optional: 'Optional',
};

export const SEVERITY_TONE: Record<Severity, Tone> = {
  blocking: 'red',
  should_fix: 'amber',
  optional: 'neutral',
};

export const SEVERITY_VERDICT: Record<Severity, FindingVerdictKind> = {
  blocking: 'fix',
  should_fix: 'fix',
  optional: 'dismiss',
};

export const SEVERITY_ATTENTION: Record<Severity, Attention> = {
  blocking: 'critical',
  should_fix: 'high',
  optional: 'normal',
};

function readSeverity(value: unknown): Severity {
  return FINDING_SEVERITIES.find((severity) => severity === value) ?? 'optional';
}

export function listSeverityCounts(findings: readonly Pick<ReviewFinding, 'severity'>[]) {
  return FINDING_SEVERITIES.flatMap((severity) => {
    const count = findings.filter((finding) => finding.severity === severity).length;
    if (count === 0) return [];
    return [`${count} ${SEVERITY_LABEL[severity].toLowerCase()}`];
  });
}

export function describeFindingPlace({ file, line, end }: FindingPlace) {
  if (!file) return null;
  const path = resolveShortPath(file);
  if (line === null) return path;
  return end !== null && end !== undefined && end !== line ? `${path}:${line}-${end}` : `${path}:${line}`;
}

function readOptionalText(record: Record<string, unknown>, key: 'title' | 'fix') {
  const value = readString(record, key);
  return value ? { [key]: value } : {};
}

function readLine(value: unknown) {
  return typeof value === 'number' ? value : null;
}

export function readReportedFindings(args: ChatToolArgs): ReviewFinding[] {
  return readList(args, 'findings').map((finding) => ({
    severity: readSeverity(finding.severity),
    file: readString(finding, 'file'),
    line: readLine(finding.line),
    end: readLine(finding.end),
    message: readString(finding, 'message') ?? '',
    ...readOptionalText(finding, 'title'),
    ...readOptionalText(finding, 'fix'),
  }));
}

export function describeReportedFindings(findings: ReviewFinding[]) {
  if (findings.length === 0) return { title: 'Reported no findings', meta: null };
  return {
    title: `Reported ${formatCount(findings.length, 'finding', 'findings')}`,
    meta: listSeverityCounts(findings).join(', '),
  };
}
