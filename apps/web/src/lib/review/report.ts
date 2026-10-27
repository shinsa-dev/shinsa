import {
  type CodeSpot,
  type Coverage,
  type DiffFile,
  hasTesting,
  type JudgementAlternative,
  type JudgementCall,
  type MergeStep,
  type MergeStepTiming,
  type ReportRisk,
  type ReviewDisagreement,
  type ReviewFinding,
  selectMeasuredCoverage,
  type WorkReport,
} from '@shinsa/core';
import { resolveShortPath } from '@/lib/chat/tool-describe.ts';
import { formatCount } from '@/lib/format/count.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { describeCommentLines, type LineComment } from '@/lib/review/draft.ts';
import { MERGE_STEP_ICON, MERGE_STEP_TITLE } from '@/lib/review/merge-steps.ts';
import { ATTENTION } from '@/lib/tasks/status.ts';

export type ReviewAuthor = 'review' | 'agent' | 'you';

type ReviewChapterId = 'built' | 'code' | 'calls' | 'careful' | 'review';

export type ReviewProseId = 'approach' | 'flow' | 'testing' | 'pre_merge' | 'post_merge';

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
  lead: string | null;
  body: string;
  why: string | null;
  fix: string | null;
  place: ReviewPlace | null;
  section: string | null;
  finding: number | null;
  alternatives: JudgementAlternative[];
  disagreement: string | null;
}

interface ReviewProse {
  key: ReviewProseId;
  title: string;
  icon: ReviewProseIcon;
}

export interface ReviewChapter {
  id: ReviewChapterId;
  title: string;
  prose: ReviewProse[];
  items: ReviewItem[];
}

export interface ReviewStop {
  key: string;
  chapter: ReviewChapterId;
  chapterTitle: string;
  title: string;
  number: number | null;
  icon: ReviewProseIcon | null;
  item: ReviewItem | null;
}

export interface ReviewMark {
  key: string;
  top: number;
}

const REVIEW_AUTHOR: Record<Exclude<ReviewAuthor, 'agent'>, string> = {
  review: 'Agent review',
  you: 'You',
};

export const REVIEW_AUTHOR_ICON: Record<ReviewAuthor, 'IconEyeSparkle' | 'IconAgent' | 'IconBubbleText'> = {
  review: 'IconEyeSparkle',
  agent: 'IconAgent',
  you: 'IconBubbleText',
};

export function isFindingItem(item: ReviewItem) {
  return item.author === 'review';
}

const FINDING_LABEL: Record<ReviewFinding['severity'], { label: string; tone: Tone }> = {
  blocking: { label: 'Blocking', tone: 'red' },
  suggestion: { label: 'Suggestion', tone: 'amber' },
};

const CALL_LABEL = { label: 'Judgement call', tone: 'purple' } as const;

const DISPUTED_LABEL = { label: 'Disputed', tone: 'orange' } as const;

const CHAPTER_TITLE: Record<ReviewChapterId, string> = {
  built: 'How it’s built',
  code: 'Key code',
  calls: 'Judgement calls',
  careful: 'Read carefully',
  review: 'Agent review',
};

export const REVIEW_PROSE_TITLE: Record<ReviewProseId, string> = {
  approach: 'Approach',
  flow: 'How it works',
  testing: 'How to test',
  ...MERGE_STEP_TITLE,
};

export const REVIEW_PROSE_ICON = {
  approach: 'IconLightbulbGlow',
  flow: 'IconLayersThree',
  testing: 'IconTestTube',
  ...MERGE_STEP_ICON,
} as const satisfies Record<ReviewProseId, string>;

type ReviewProseIcon = (typeof REVIEW_PROSE_ICON)[ReviewProseId];

const BLANK: Pick<
  ReviewItem,
  'lead' | 'why' | 'fix' | 'section' | 'finding' | 'alternatives' | 'disagreement'
> = {
  lead: null,
  why: null,
  fix: null,
  section: null,
  finding: null,
  alternatives: [],
  disagreement: null,
};

function resolveLinePlace(file: string | null, line: number | null, end?: number | null): ReviewPlace | null {
  if (!file || line === null) return null;
  return { file, start: line, end: Math.max(end ?? line, line) };
}

export function toFindingItem(finding: ReviewFinding, index: number): ReviewItem {
  return {
    ...BLANK,
    key: `finding:${index}`,
    ...FINDING_LABEL[finding.severity],
    author: 'review',
    title: finding.title ?? null,
    body: finding.message,
    fix: finding.fix ?? null,
    place: resolveLinePlace(finding.file, finding.line, finding.end),
    finding: index,
  };
}

function toSpotItem(spot: CodeSpot, section: string, key: string): ReviewItem {
  return {
    ...BLANK,
    key,
    ...ATTENTION[spot.attention],
    author: 'agent',
    title: spot.title ?? null,
    body: spot.explain ?? spot.why,
    why: spot.explain ? spot.why : null,
    place: { file: spot.file, start: spot.start, end: Math.max(spot.end, spot.start) },
    section,
  };
}

function toCallItem(call: JudgementCall, index: number, disagreement: string | null): ReviewItem {
  return {
    ...BLANK,
    key: `call:${index}`,
    ...(disagreement ? DISPUTED_LABEL : CALL_LABEL),
    author: 'agent',
    title: call.title,
    lead: call.call,
    body: call.reason,
    place: resolveLinePlace(call.file, call.line, call.end),
    alternatives: call.alternatives ?? [],
    disagreement,
  };
}

function toRiskItem(risk: ReportRisk, index: number): ReviewItem {
  return {
    ...BLANK,
    key: `risk:${index}`,
    label: 'Risk',
    tone: 'amber',
    author: 'agent',
    title: risk.title,
    body: risk.risk,
    place: resolveLinePlace(risk.file, risk.line, risk.end),
  };
}

function listSpotItems(report: WorkReport) {
  return report.sections.flatMap((section, sectionIndex) =>
    section.spots.map((spot, spotIndex) => toSpotItem(spot, section.title, `${sectionIndex}:${spotIndex}`))
  );
}

function isCareful(item: ReviewItem) {
  return item.label === ATTENTION.critical.label || item.label === ATTENTION.high.label;
}

function listCallItems(report: WorkReport, disagreements: readonly ReviewDisagreement[]) {
  const open = [...disagreements];
  return report.judgementCalls.map((call, index) => {
    const at = open.findIndex((entry) => entry.call === call.call);
    const match = at < 0 ? null : open.splice(at, 1)[0];
    return toCallItem(call, index, match?.reason ?? null);
  });
}

function listFindingItems(findings: readonly ReviewFinding[]) {
  const bySeverity = (severity: ReviewFinding['severity']) =>
    findings.flatMap((finding, index) =>
      finding.severity === severity ? [toFindingItem(finding, index)] : []
    );
  return [...bySeverity('blocking'), ...bySeverity('suggestion')];
}

function toProse(...keys: ReviewProseId[]): ReviewProse[] {
  return keys.map((key) => ({ key, title: REVIEW_PROSE_TITLE[key], icon: REVIEW_PROSE_ICON[key] }));
}

function listBuiltProse(
  report: WorkReport | null,
  steps: readonly MergeStep[],
  coverage: Coverage | null
): ReviewProseId[] {
  const walkthrough = report?.walkthrough ?? null;
  const tested =
    hasTesting(walkthrough?.testing) ||
    (report?.checks.length ?? 0) > 0 ||
    selectMeasuredCoverage(coverage) !== null;
  const timed = (when: MergeStepTiming) => (steps.some((step) => step.when === when) ? [when] : []);
  return [
    ...(walkthrough ? (['approach', 'flow'] as const) : []),
    ...(tested ? (['testing'] as const) : []),
    ...timed('pre_merge'),
    ...timed('post_merge'),
  ];
}

function listChapterProse(
  report: WorkReport | null,
  steps: readonly MergeStep[],
  coverage: Coverage | null
): Record<ReviewChapterId, ReviewProse[]> {
  return {
    built: toProse(...listBuiltProse(report, steps, coverage)),
    code: [],
    calls: [],
    careful: [],
    review: [],
  };
}

export function listReviewChapters(
  report: WorkReport | null,
  findings: readonly ReviewFinding[],
  disagreements: readonly ReviewDisagreement[] = [],
  steps: readonly MergeStep[] = report?.walkthrough?.steps ?? [],
  coverage: Coverage | null = null
): ReviewChapter[] {
  const spots = report ? listSpotItems(report) : [];
  const prose = listChapterProse(report, steps, coverage);
  const items: Record<ReviewChapterId, ReviewItem[]> = {
    built: [],
    code: spots.filter((item) => !isCareful(item)),
    calls: report ? listCallItems(report, disagreements) : [],
    careful: [...spots.filter(isCareful), ...(report?.walkthrough?.risks ?? []).map(toRiskItem)],
    review: listFindingItems(findings),
  };
  return (Object.keys(CHAPTER_TITLE) as ReviewChapterId[]).flatMap((id) =>
    items[id].length > 0 || prose[id].length > 0
      ? [{ id, title: CHAPTER_TITLE[id], prose: prose[id], items: items[id] }]
      : []
  );
}

export function listReviewPoints(chapters: readonly ReviewChapter[]) {
  return chapters.flatMap((chapter) => chapter.items);
}

function stripInlineMarkdown(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`|\*\*/g, '')
    .trim();
}

export function resolvePointTitle(item: ReviewItem) {
  return stripInlineMarkdown(item.title ?? item.body.split(/(?<=[.:])\s/)[0] ?? '');
}

export function resolveNoteHeading(item: ReviewItem) {
  if (item.author === 'agent') return { author: null, title: resolvePointTitle(item) };
  return { author: REVIEW_AUTHOR[item.author], title: null };
}

export function listReviewStops(chapters: readonly ReviewChapter[]): ReviewStop[] {
  let number = 0;
  return chapters.flatMap((chapter) => {
    const place = { chapter: chapter.id, chapterTitle: chapter.title };
    return [
      ...chapter.prose.map((prose) => ({
        key: prose.key,
        ...place,
        title: prose.title,
        number: null,
        icon: prose.icon,
        item: null,
      })),
      ...chapter.items.map((item) => {
        number += 1;
        return { key: item.key, ...place, title: resolvePointTitle(item), number, icon: null, item };
      }),
    ];
  });
}

export function describeStopPosition(stop: ReviewStop, total: number) {
  return stop.number === null ? null : `${stop.number} of ${total}`;
}

export function resolveStopInView(marks: readonly ReviewMark[], line: number, bottom: number | null) {
  const reached = marks.filter((mark) => mark.top <= (bottom ?? line));
  return reached.at(-1)?.key ?? null;
}

export function stepReviewItem<T extends { key: string }>(
  items: readonly T[],
  key: string | null,
  delta: 1 | -1
) {
  if (items.length === 0) return null;
  const index = items.findIndex((item) => item.key === key);
  if (index < 0) return (delta > 0 ? items[0] : items.at(-1)) ?? null;
  return items[Math.min(items.length - 1, Math.max(0, index + delta))] ?? null;
}

function isCovered(path: string, report: WorkReport | null, findings: readonly ReviewFinding[]) {
  if (findings.some((finding) => finding.file === path)) return true;
  if (!report) return false;
  if (report.judgementCalls.some((call) => call.file === path)) return true;
  if (report.walkthrough?.risks.some((risk) => risk.file === path)) return true;
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

function countLabel(items: readonly ReviewItem[], ...labels: string[]) {
  return items.filter((item) => labels.includes(item.label)).length;
}

export function describePointCount(items: readonly ReviewItem[]) {
  if (items.length === 0) return 'No point is marked. The changed files are under Everything else.';
  const calls = countLabel(items, CALL_LABEL.label, DISPUTED_LABEL.label);
  const detail = [
    [countLabel(items, 'Blocking'), 'blocking'],
    [countLabel(items, ATTENTION.critical.label), 'critical'],
    [calls, calls === 1 ? 'judgement call' : 'judgement calls'],
    [countLabel(items, DISPUTED_LABEL.label), 'disputed by the agent review'],
  ].flatMap(([count, label]) => (Number(count) > 0 ? [`${count} ${label}`] : []));
  const total = formatCount(items.length, 'point', 'points');
  return detail.length > 0 ? `${total} to read, ${detail.join(', ')}.` : `${total} to read.`;
}

export function toCommentItem(comment: LineComment): ReviewItem {
  return {
    ...BLANK,
    key: `comment:${comment.id}`,
    label: describeCommentLines(comment),
    tone: 'blue',
    author: 'you',
    title: null,
    body: comment.text,
    place:
      comment.side === 'new'
        ? {
            file: comment.path,
            start: comment.line,
            end: Math.max(comment.endLine ?? comment.line, comment.line),
          }
        : null,
    section: comment.side === 'new' ? null : comment.path,
  };
}

export function describeItemPlace(place: ReviewPlace) {
  const lines = place.start === place.end ? `${place.start}` : `${place.start}–${place.end}`;
  return `${resolveShortPath(place.file)}:${lines}`;
}
