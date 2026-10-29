import type { Attention, CodeSpot, ReviewFinding, WorkReport } from '@shinsa/core';
import { SEVERITY_ATTENTION } from '@/lib/review/findings.ts';

export interface ReviewTarget {
  key: string;
  file: string;
  start: number;
  end: number;
  attention: Attention;
  why: string;
  section: string;
}

function toReviewTarget(spot: CodeSpot, section: string, key: string): ReviewTarget {
  return { key, ...spot, section };
}

interface PlacedNote {
  file: string | null;
  line: number | null;
  end?: number | null;
}

function toPlacedTarget(
  note: PlacedNote,
  key: string,
  attention: Attention,
  why: string,
  section: string
): ReviewTarget[] {
  if (!note.file || note.line === null) return [];
  return [
    {
      key,
      file: note.file,
      start: note.line,
      end: Math.max(note.end ?? note.line, note.line),
      attention,
      why,
      section,
    },
  ];
}

export function listReviewTargets(report: WorkReport): ReviewTarget[] {
  const spots = report.sections.flatMap((section, sectionIndex) =>
    section.spots.map((spot, spotIndex) =>
      toReviewTarget(spot, section.title, `${sectionIndex}:${spotIndex}`)
    )
  );
  const calls = report.judgementCalls.flatMap((call, index) =>
    toPlacedTarget(call, `call:${index}`, 'normal', call.call, 'Judgement calls')
  );
  const risks = (report.walkthrough?.risks ?? []).flatMap((risk, index) =>
    toPlacedTarget(risk, `risk:${index}`, 'high', risk.risk, 'Risks and edge cases')
  );
  return [...spots, ...calls, ...risks];
}

function isLocated(finding: ReviewFinding): finding is ReviewFinding & { file: string; line: number } {
  return Boolean(finding.file && finding.line);
}

export function listFindingTargets(findings: ReviewFinding[]): ReviewTarget[] {
  return findings.flatMap((finding, index) =>
    isLocated(finding)
      ? [
          {
            key: `finding:${index}`,
            file: finding.file,
            start: finding.line,
            end: finding.end ?? finding.line,
            attention: SEVERITY_ATTENTION[finding.severity],
            why: finding.message,
            section: 'Agent review',
          },
        ]
      : []
  );
}
