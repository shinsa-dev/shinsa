import type { ChatToolArgs, ReviewFinding } from '@shinsa/core';
import { readList, readString, resolveShortPath } from '@/lib/chat/tool-describe.ts';
import { formatCount } from '@/lib/format/count.ts';

export type FindingPlace = Pick<ReviewFinding, 'file' | 'line' | 'end'>;

export const SEVERITY_LABEL: Record<ReviewFinding['severity'], string> = {
  blocking: 'Blocking',
  suggestion: 'Suggestion',
};

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
    severity: finding.severity === 'blocking' ? 'blocking' : 'suggestion',
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
  const blocking = findings.filter((finding) => finding.severity === 'blocking').length;
  return {
    title: `Reported ${formatCount(findings.length, 'finding', 'findings')}`,
    meta: blocking > 0 ? `${blocking} blocking` : 'Suggestions only',
  };
}
