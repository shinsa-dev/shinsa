import {
  type Attention,
  type CodeSpot,
  listRankedSpots,
  type ReviewFinding,
  type WorkReport,
} from '@shinsa/core';

export type ReviewOrder = 'walkthrough' | 'attention';

export const REVIEW_ORDERS: { value: ReviewOrder; label: string }[] = [
  { value: 'walkthrough', label: 'Walkthrough' },
  { value: 'attention', label: 'By attention' },
];

export interface ReviewTarget {
  key: string;
  file: string;
  start: number;
  end: number;
  attention: Attention;
  why: string;
  section: string;
}

export function toReviewTarget(spot: CodeSpot, section: string, key: string): ReviewTarget {
  return { key, ...spot, section };
}

export function listReviewTargets(report: WorkReport, order: ReviewOrder): ReviewTarget[] {
  if (order === 'attention') {
    return listRankedSpots(report).map(({ spot, sectionIndex, spotIndex }) =>
      toReviewTarget(spot, report.sections[sectionIndex]?.title ?? '', `${sectionIndex}:${spotIndex}`)
    );
  }
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

export function stepTarget(targets: ReviewTarget[], index: number, delta: 1 | -1) {
  if (targets.length === 0) return null;
  const from = index < 0 ? (delta > 0 ? -1 : 0) : index;
  return targets[(from + delta + targets.length) % targets.length] ?? null;
}

export function formatTargetLines(target: ReviewTarget) {
  return target.start === target.end ? String(target.start) : `${target.start}–${target.end}`;
}
