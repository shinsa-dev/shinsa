import type { Attention, CodeSpot, ReviewFinding, WorkReport } from '@shinsa/core';

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

export function listReviewTargets(report: WorkReport): ReviewTarget[] {
  return report.sections.flatMap((section, sectionIndex) =>
    section.spots.map((spot, spotIndex) =>
      toReviewTarget(spot, section.title, `${sectionIndex}:${spotIndex}`)
    )
  );
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
            attention: finding.severity === 'blocking' ? ('critical' as const) : ('high' as const),
            why: finding.message,
            section: 'Agent review',
          },
        ]
      : []
  );
}
