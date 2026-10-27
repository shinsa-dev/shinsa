import type { CommentSide, ReviewFinding } from '@shinsa/core';
import type { Tone } from '@/lib/format/tone.ts';
import type { LineComment } from '@/lib/review/draft.ts';
import { type ReviewItem, toFindingItem } from '@/lib/review/report.ts';
import type { ReviewTarget } from '@/lib/review/targets.ts';
import { ATTENTION } from '@/lib/tasks/status.ts';

export type CodeNote =
  | { kind: 'finding'; key: string; side: CommentSide; line: number; item: ReviewItem }
  | { kind: 'comment'; key: string; side: CommentSide; line: number; comment: LineComment }
  | { kind: 'composer'; key: string; side: CommentSide; line: number; start: number; endLine: number | null };

export interface CodeSpotMark {
  key: string;
  from: number;
  to: number;
  tone: Tone;
  label: string;
  selected: boolean;
}

export interface Composer {
  side: CommentSide;
  line: number;
  endLine: number | null;
}

export function listFindingNotes(findings: readonly ReviewFinding[], path: string): CodeNote[] {
  return findings.flatMap((finding, index) => {
    if (finding.file !== path || !finding.line) return [];
    return [
      {
        kind: 'finding' as const,
        key: `finding:${index}`,
        side: 'new' as const,
        line: finding.end ?? finding.line,
        item: toFindingItem(finding, index),
      },
    ];
  });
}

export function listCommentNotes(
  comments: readonly LineComment[],
  path: string,
  ref: string | null
): CodeNote[] {
  return comments
    .filter((comment) => comment.path === path && (comment.ref === null || comment.ref === ref))
    .map((comment) => ({
      kind: 'comment' as const,
      key: `comment:${comment.id}`,
      side: comment.side,
      line: comment.endLine ?? comment.line,
      comment,
    }));
}

export function listFileNotes(input: {
  path: string;
  ref: string | null;
  findings: readonly ReviewFinding[];
  comments: readonly LineComment[];
  composer: Composer | null;
}): CodeNote[] {
  const notes = [
    ...listFindingNotes(input.findings, input.path),
    ...listCommentNotes(input.comments, input.path, input.ref),
  ];
  if (input.composer) {
    notes.push({
      kind: 'composer',
      key: 'composer',
      side: input.composer.side,
      line: input.composer.endLine ?? input.composer.line,
      start: input.composer.line,
      endLine: input.composer.endLine,
    });
  }
  return notes;
}

function describeSpotMark(target: Pick<ReviewTarget, 'attention' | 'why'>) {
  const label = ATTENTION[target.attention].label;
  const why = target.why.trim();
  return why ? `${label}: ${why}` : label;
}

export function listSpotMarks(
  targets: readonly ReviewTarget[],
  path: string,
  selected: string | null
): CodeSpotMark[] {
  return targets
    .filter((target) => target.file === path)
    .map((target) => ({
      key: target.key,
      from: target.start,
      to: Math.max(target.start, target.end),
      tone: ATTENTION[target.attention].tone,
      label: describeSpotMark(target),
      selected: target.key === selected,
    }));
}

export function resolveCommentRange(
  clicked: number,
  selection: { from: number; to: number } | null
): { line: number; endLine: number | null } {
  if (selection && selection.from < selection.to && clicked >= selection.from && clicked <= selection.to) {
    return { line: selection.from, endLine: selection.to };
  }
  return { line: clicked, endLine: null };
}
