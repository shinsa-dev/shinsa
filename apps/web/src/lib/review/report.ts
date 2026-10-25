import type { CodeSpot, DiffFile, ReviewFinding, WorkReport } from '@shinsa/core';
import { resolveShortPath } from '@/lib/chat/tool-describe.ts';
import { formatCount } from '@/lib/format/count.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { describeCommentLines, type LineComment } from '@/lib/review/draft.ts';
import { ATTENTION } from '@/lib/tasks/status.ts';

export type ReviewAuthor = 'review' | 'agent' | 'you';

export interface ReviewPlace {
  file: string;
  start: number;
  end: number;
}

export interface ReviewItem {
  key: string;
  label: string;
  tone: Tone;
  author: ReviewAuthor;
  title: string | null;
  body: string;
  fix: string | null;
  place: ReviewPlace | null;
  section: string | null;
  finding: number | null;
  related: ReviewItem[];
}

export interface ReviewSection {
  title: string;
  summary: string;
  spots: ReviewItem[];
}

export const REVIEW_AUTHOR: Record<
  ReviewAuthor,
  { label: string; icon: 'IconEyeSparkle' | 'IconAgent' | 'IconBubbleText' }
> = {
  review: { label: 'Agent review', icon: 'IconEyeSparkle' },
  agent: { label: 'Agent', icon: 'IconAgent' },
  you: { label: 'You', icon: 'IconBubbleText' },
};

const FINDING_LABEL: Record<ReviewFinding['severity'], { label: string; tone: Tone }> = {
  blocking: { label: 'Blocking', tone: 'red' },
  suggestion: { label: 'Suggestion', tone: 'amber' },
};

function resolveFindingPlace(finding: ReviewFinding): ReviewPlace | null {
  if (!finding.file || finding.line === null) return null;
  return {
    file: finding.file,
    start: finding.line,
    end: Math.max(finding.end ?? finding.line, finding.line),
  };
}

export function toFindingItem(finding: ReviewFinding, index: number): ReviewItem {
  return {
    key: `finding:${index}`,
    ...FINDING_LABEL[finding.severity],
    author: 'review',
    title: finding.title ?? null,
    body: finding.message,
    fix: finding.fix ?? null,
    place: resolveFindingPlace(finding),
    section: null,
    finding: index,
    related: [],
  };
}

function toSpotItem(spot: CodeSpot, section: string, key: string): ReviewItem {
  return {
    key,
    ...ATTENTION[spot.attention],
    author: 'agent',
    title: null,
    body: spot.why,
    fix: null,
    place: { file: spot.file, start: spot.start, end: Math.max(spot.end, spot.start) },
    section,
    finding: null,
    related: [],
  };
}

export function listReviewSections(report: WorkReport): ReviewSection[] {
  return report.sections.map((section, sectionIndex) => ({
    title: section.title,
    summary: section.summary,
    spots: section.spots.map((spot, spotIndex) =>
      toSpotItem(spot, section.title, `${sectionIndex}:${spotIndex}`)
    ),
  }));
}

function listJudgementItems(report: WorkReport): ReviewItem[] {
  return report.judgementCalls.map((call, index) => ({
    key: `call:${index}`,
    label: 'Judgement call',
    tone: 'purple',
    author: 'agent',
    title: call.call,
    body: call.reason,
    fix: null,
    place: call.file && call.line !== null ? { file: call.file, start: call.line, end: call.line } : null,
    section: null,
    finding: null,
    related: [],
  }));
}

function listSpotsAt(report: WorkReport, attention: CodeSpot['attention']) {
  return report.sections.flatMap((section, sectionIndex) =>
    section.spots.flatMap((spot, spotIndex) =>
      spot.attention === attention ? [toSpotItem(spot, section.title, `${sectionIndex}:${spotIndex}`)] : []
    )
  );
}

export function listAttentionItems(
  report: WorkReport | null,
  findings: readonly ReviewFinding[]
): ReviewItem[] {
  const bySeverity = (severity: ReviewFinding['severity']) =>
    findings.flatMap((finding, index) =>
      finding.severity === severity ? [toFindingItem(finding, index)] : []
    );
  const blocking = bySeverity('blocking');
  const suggestions = bySeverity('suggestion');
  if (!report) return [...blocking, ...suggestions];
  const findingItems = [...blocking, ...suggestions];
  const spots = [...listSpotsAt(report, 'critical'), ...listSpotsAt(report, 'high')].filter((spot) => {
    const owner = findingItems.find((item) => overlaps(item.place, spot.place));
    owner?.related.push(spot);
    return !owner;
  });
  return [...blocking, ...spots, ...suggestions, ...listJudgementItems(report)];
}

function overlaps(a: ReviewPlace | null, b: ReviewPlace | null) {
  if (!a || !b || a.file !== b.file) return false;
  return a.start <= b.end && b.start <= a.end;
}

export function stepReviewItem(items: readonly ReviewItem[], key: string | null, delta: 1 | -1) {
  if (items.length === 0) return null;
  const index = items.findIndex((item) => item.key === key);
  if (index < 0) return (delta > 0 ? items[0] : items.at(-1)) ?? null;
  return items[Math.min(items.length - 1, Math.max(0, index + delta))] ?? null;
}

function isCovered(path: string, report: WorkReport | null, findings: readonly ReviewFinding[]) {
  if (findings.some((finding) => finding.file === path)) return true;
  if (!report) return false;
  if (report.judgementCalls.some((call) => call.file === path)) return true;
  return report.sections.some((section) => section.spots.some((spot) => spot.file === path));
}

export function listOtherFiles(
  files: readonly DiffFile[],
  report: WorkReport | null,
  findings: readonly ReviewFinding[]
) {
  return files.filter((file) => !isCovered(file.path, report, findings));
}

export function describeAgentReview(findings: readonly ReviewFinding[]) {
  if (findings.length === 0) return 'Found nothing to fix.';
  const blocking = findings.filter((finding) => finding.severity === 'blocking').length;
  const suggestions = findings.length - blocking;
  const parts = [
    blocking > 0 ? formatCount(blocking, 'blocking finding', 'blocking findings') : null,
    suggestions > 0 ? formatCount(suggestions, 'suggestion', 'suggestions') : null,
  ].filter((part) => part !== null);
  return `Found ${parts.join(' and ')}.`;
}

export function describeAttentionCount(items: readonly ReviewItem[]) {
  if (items.length === 0) return 'Nothing stands out. Read the walkthrough below.';
  return `${formatCount(items.length, 'place needs', 'places need')} your attention, the most critical first.`;
}

export function toCommentItem(comment: LineComment): ReviewItem {
  return {
    key: `comment:${comment.id}`,
    label: describeCommentLines(comment),
    tone: 'blue',
    author: 'you',
    title: null,
    body: comment.text,
    fix: null,
    place:
      comment.side === 'new'
        ? {
            file: comment.path,
            start: comment.line,
            end: Math.max(comment.endLine ?? comment.line, comment.line),
          }
        : null,
    section: comment.side === 'new' ? null : comment.path,
    finding: null,
    related: [],
  };
}

export function describeItemPlace(place: ReviewPlace) {
  const lines = place.start === place.end ? `${place.start}` : `${place.start}–${place.end}`;
  return `${resolveShortPath(place.file)}:${lines}`;
}
