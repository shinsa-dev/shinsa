import type { Evidence, EvidenceStage, EvidenceTheme, Repo, Task, TaskStage } from '../domain/types.ts';
import { EVIDENCE_STAGES, EVIDENCE_THEMES } from '../domain/verification.ts';
import { assembleReport } from './assemble.ts';
import { listPullRequestEvidence, resolvePublicUrl } from './pull-request.ts';
import type {
  JudgementCall,
  ManualTestStep,
  ReportCheck,
  ReportRisk,
  ReportWalkthrough,
  ReviewFinding,
  WorkReport,
} from './types.ts';

export const REVIEW_PAYLOAD_VERSION = 1;

type ReviewEvidenceKind = Extract<Evidence['kind'], 'screenshot' | 'recording' | 'preview'>;

const REVIEW_EVIDENCE_KINDS: readonly ReviewEvidenceKind[] = ['screenshot', 'recording', 'preview'];

const FINDING_SEVERITIES: readonly ReviewFinding['severity'][] = ['blocking', 'suggestion'];

const CHECK_OUTCOMES: readonly ReportCheck['outcome'][] = ['pass', 'fail', 'skipped'];

const TEST_TARGETS: readonly NonNullable<ManualTestStep['target']>['kind'][] = [
  'url',
  'file',
  'command',
  'screen',
];

export interface ReviewPayloadEvidence {
  id: string;
  itemId: string;
  kind: ReviewEvidenceKind;
  title: string;
  url: string;
  detail: string | null;
  width: number | null;
  theme: EvidenceTheme | null;
  stage: EvidenceStage | null;
  label: string | null;
}

export interface ReviewPayload {
  v: typeof REVIEW_PAYLOAD_VERSION;
  task: {
    id: string;
    handle: string | null;
    title: string;
    summary: string | null;
    pullRequest: number | null;
    repo: string | null;
    slug: string | null;
    branch: string | null;
    coverage: ReviewPayloadCoverage | null;
    stage: ReviewPayloadStage;
    startedAt: number | null;
  };
  report: WorkReport;
  evidence: ReviewPayloadEvidence[];
  review: ReviewPayloadVerdict | null;
}

interface ReviewPayloadCoverage {
  covered: number;
  executable: number;
}

interface ReviewPayloadVerdict {
  summary: string;
  findings: ReviewFinding[];
}

type ReviewPayloadStage = Extract<TaskStage, 'shipping' | 'awaiting_merge' | 'merged' | 'done'>;

const REVIEW_PAYLOAD_STAGES: readonly ReviewPayloadStage[] = ['shipping', 'awaiting_merge', 'merged', 'done'];

function resolvePayloadStage(stage: TaskStage): ReviewPayloadStage {
  return REVIEW_PAYLOAD_STAGES.find((known) => known === stage) ?? 'shipping';
}

const REPO_SLUG = /^[\w.-]+\/[\w.-]+$/;

const BRANCH_NAME = /^[\w./-]{1,200}$/;

const GITHUB_ATTACHMENT =
  /^https:\/\/(?:github\.com\/user-attachments\/|[a-z0-9-]+\.githubusercontent\.com\/)/;

function isReviewEvidenceKind(kind: Evidence['kind']): kind is ReviewEvidenceKind {
  return (REVIEW_EVIDENCE_KINDS as readonly string[]).includes(kind);
}

function listPayloadEvidence(task: Task, evidence: readonly Evidence[]): ReviewPayloadEvidence[] {
  return listPullRequestEvidence(task, evidence).flatMap((item) =>
    item.parts.flatMap((part) => {
      const url = resolvePublicUrl(part);
      if (!url || !GITHUB_ATTACHMENT.test(url) || !isReviewEvidenceKind(part.kind)) return [];
      return [
        {
          id: part.id,
          itemId: item.id,
          kind: part.kind,
          title: part.title,
          url,
          detail: part.detail ?? null,
          width: part.width ?? null,
          theme: part.theme ?? null,
          stage: part.stage ?? null,
          label: part.label ?? null,
        },
      ];
    })
  );
}

function resolveRepoSlug(remote: string | null) {
  const slug =
    remote
      ?.replace(/\.git$/, '')
      .split(/[/:]/)
      .slice(-2)
      .join('/') ?? '';
  return REPO_SLUG.test(slug) ? slug : null;
}

function serializeCoverage(task: Task): ReviewPayloadCoverage | null {
  const coverage = task.coverage;
  if (coverage?.status !== 'measured') return null;
  return { covered: coverage.covered, executable: coverage.executable };
}

function serializeVerdict(task: Task): ReviewPayloadVerdict | null {
  if (task.reviewSummary === null) return null;
  return {
    summary: task.reviewSummary,
    findings: task.findings
      .filter((finding) => finding.verdict === undefined)
      .map((finding) => ({
        severity: finding.severity,
        file: null,
        line: null,
        ...(finding.title ? { title: finding.title } : {}),
        message: finding.message,
      })),
  };
}

export function serializeReviewPayload(
  task: Task,
  evidence: readonly Evidence[],
  repo: Pick<Repo, 'name' | 'remote'> | null = null
): ReviewPayload {
  const report = assembleReport(task);
  const walkthrough = report.walkthrough
    ? {
        ...report.walkthrough,
        risks: report.walkthrough.risks.map((risk) => ({ ...risk, file: null, line: null, end: null })),
      }
    : null;
  return {
    v: REVIEW_PAYLOAD_VERSION,
    task: {
      id: task.id,
      handle: task.handle ?? null,
      title: task.title,
      summary: task.summary,
      pullRequest: task.pullRequest?.number ?? null,
      repo: repo?.name ?? null,
      slug: resolveRepoSlug(repo?.remote ?? null),
      branch: task.branch,
      coverage: serializeCoverage(task),
      stage: resolvePayloadStage(task.stage),
      startedAt: task.createdAt,
    },
    report: {
      ...report,
      sections: report.sections.map((section) => ({ ...section, spots: [] })),
      checks: report.checks.map((check) => ({ ...check, detail: null })),
      judgementCalls: report.judgementCalls.map((call) => ({ ...call, file: null, line: null, end: null })),
      walkthrough,
    },
    evidence: listPayloadEvidence(task, evidence),
    review: serializeVerdict(task),
  };
}

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(fields: Fields, key: string) {
  const value = fields[key];
  return typeof value === 'string' ? value : null;
}

function readTexts(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readNumber(fields: Fields, key: string) {
  const value = fields[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readPullRequestNumber(fields: Fields) {
  const value = readNumber(fields, 'pullRequest');
  return value !== null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function readChoice<T extends string>(fields: Fields, key: string, choices: readonly T[]) {
  const value = fields[key];
  return choices.find((choice) => choice === value) ?? null;
}

function listFields(value: unknown) {
  return Array.isArray(value) ? value.filter(isFields) : [];
}

function parseCheck(fields: Fields): ReportCheck | null {
  const id = readText(fields, 'id');
  const label = readText(fields, 'label');
  const command = readText(fields, 'command');
  const outcome = readChoice(fields, 'outcome', CHECK_OUTCOMES);
  if (!id || !label || command === null || !outcome) return null;
  return { id, label, command, outcome, detail: null };
}

function parseCall(fields: Fields): JudgementCall | null {
  const title = readText(fields, 'title');
  const call = readText(fields, 'call');
  if (!title || !call) return null;
  const alternatives = listFields(fields.alternatives).flatMap((alternative) => {
    const option = readText(alternative, 'option');
    const rejected = readText(alternative, 'rejected');
    return option && rejected ? [{ option, rejected }] : [];
  });
  return {
    title,
    call,
    reason: readText(fields, 'reason') ?? '',
    file: null,
    line: null,
    end: null,
    alternatives,
  };
}

function parseRisk(fields: Fields): ReportRisk | null {
  const title = readText(fields, 'title');
  const risk = readText(fields, 'risk');
  return title && risk ? { title, risk, file: null, line: null, end: null } : null;
}

function parseStep(fields: Fields): ManualTestStep | null {
  const action = readText(fields, 'action');
  const expect = readText(fields, 'expect');
  if (!action || !expect) return null;
  const target = isFields(fields.target) ? fields.target : null;
  const kind = target ? readChoice(target, 'kind', TEST_TARGETS) : null;
  const value = target ? readText(target, 'value') : null;
  return { action, expect, target: kind && value ? { kind, value } : null };
}

function parseWalkthrough(value: unknown): ReportWalkthrough | null {
  if (!isFields(value)) return null;
  const testing = isFields(value.testing) ? value.testing : {};
  return {
    approach: readText(value, 'approach') ?? '',
    flow: readText(value, 'flow') ?? '',
    risks: listFields(value.risks).flatMap((risk) => parseRisk(risk) ?? []),
    testing: {
      automated: readTexts(testing.automated),
      manual: listFields(testing.manual).flatMap((step) => parseStep(step) ?? []),
    },
  };
}

function parseReport(value: Fields): WorkReport {
  return {
    headline: readText(value, 'headline') ?? '',
    sections: listFields(value.sections).flatMap((section) => {
      const title = readText(section, 'title');
      const summary = readText(section, 'summary');
      return title && summary ? [{ title, summary, spots: [] }] : [];
    }),
    checks: listFields(value.checks).flatMap((check) => parseCheck(check) ?? []),
    judgementCalls: listFields(value.judgementCalls).flatMap((call) => parseCall(call) ?? []),
    walkthrough: parseWalkthrough(value.walkthrough),
  };
}

function parseEvidence(fields: Fields): ReviewPayloadEvidence | null {
  const id = readText(fields, 'id');
  const itemId = readText(fields, 'itemId');
  const kind = readChoice(fields, 'kind', REVIEW_EVIDENCE_KINDS);
  const title = readText(fields, 'title');
  const url = readText(fields, 'url');
  if (!id || !itemId || !kind || !title || !url || !GITHUB_ATTACHMENT.test(url)) return null;
  return {
    id,
    itemId,
    kind,
    title,
    url,
    detail: readText(fields, 'detail'),
    width: readNumber(fields, 'width'),
    theme: readChoice(fields, 'theme', EVIDENCE_THEMES),
    stage: readChoice(fields, 'stage', EVIDENCE_STAGES),
    label: readText(fields, 'label'),
  };
}

function parseCoverage(value: unknown): ReviewPayloadCoverage | null {
  if (!isFields(value)) return null;
  const covered = readNumber(value, 'covered');
  const executable = readNumber(value, 'executable');
  if (covered === null || executable === null || covered < 0 || covered > executable) return null;
  return { covered, executable };
}

function readMatch(fields: Fields, key: string, pattern: RegExp) {
  const value = readText(fields, key);
  return value !== null && pattern.test(value) ? value : null;
}

function parseFinding(fields: Fields): ReviewFinding | null {
  const severity = readChoice(fields, 'severity', FINDING_SEVERITIES);
  const message = readText(fields, 'message');
  if (!severity || !message) return null;
  const title = readText(fields, 'title');
  return { severity, file: null, line: null, ...(title ? { title } : {}), message };
}

function parseVerdict(value: unknown): ReviewPayloadVerdict | null {
  if (!isFields(value)) return null;
  const summary = readText(value, 'summary');
  if (summary === null) return null;
  return { summary, findings: listFields(value.findings).flatMap((finding) => parseFinding(finding) ?? []) };
}

export function parseReviewPayload(value: unknown): ReviewPayload | null {
  if (!isFields(value) || value.v !== REVIEW_PAYLOAD_VERSION) return null;
  if (!isFields(value.task) || !isFields(value.report)) return null;
  const id = readText(value.task, 'id');
  const title = readText(value.task, 'title');
  if (!id || !title) return null;
  return {
    v: REVIEW_PAYLOAD_VERSION,
    task: {
      id,
      handle: readText(value.task, 'handle'),
      title,
      summary: readText(value.task, 'summary'),
      pullRequest: readPullRequestNumber(value.task),
      repo: readMatch(value.task, 'repo', /^[\w.-]{1,100}$/),
      slug: readMatch(value.task, 'slug', REPO_SLUG),
      branch: readMatch(value.task, 'branch', BRANCH_NAME),
      coverage: parseCoverage(value.task.coverage),
      stage: readChoice(value.task, 'stage', REVIEW_PAYLOAD_STAGES) ?? 'shipping',
      startedAt: readNumber(value.task, 'startedAt'),
    },
    report: parseReport(value.report),
    evidence: listFields(value.evidence).flatMap((piece) => parseEvidence(piece) ?? []),
    review: parseVerdict(value.review),
  };
}

function withoutDetail(payload: ReviewPayload): ReviewPayload {
  const walkthrough = payload.report.walkthrough;
  return {
    ...payload,
    report: {
      ...payload.report,
      judgementCalls: payload.report.judgementCalls.map(({ alternatives: _alternatives, ...call }) => call),
      walkthrough: walkthrough && { ...walkthrough, flow: '' },
    },
  };
}

function withoutReview(payload: ReviewPayload): ReviewPayload {
  const walkthrough = payload.report.walkthrough;
  return {
    ...payload,
    review: null,
    report: {
      ...payload.report,
      walkthrough: walkthrough && {
        ...walkthrough,
        risks: [],
        testing: { ...walkthrough.testing, manual: [] },
      },
    },
  };
}

function withoutReasons(payload: ReviewPayload): ReviewPayload {
  const walkthrough = payload.report.walkthrough;
  return {
    ...payload,
    evidence: payload.evidence.map((piece) => ({ ...piece, detail: null })),
    report: {
      ...payload.report,
      judgementCalls: [],
      walkthrough: walkthrough && { ...walkthrough, steps: [], testing: { automated: [], manual: [] } },
    },
  };
}

function withOnlyFacts(payload: ReviewPayload): ReviewPayload {
  return {
    ...payload,
    evidence: [],
    review: null,
    report: { ...payload.report, sections: [], judgementCalls: [], walkthrough: null },
  };
}

export function listReviewPayloadFits(payload: ReviewPayload): ReviewPayload[] {
  const lighter = withoutDetail(payload);
  const bare = withoutReview(lighter);
  const short = withoutReasons(bare);
  return [payload, lighter, bare, short, withOnlyFacts(short)];
}
