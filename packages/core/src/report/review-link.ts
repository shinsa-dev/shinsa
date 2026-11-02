import { Option, Schema } from 'effect';
import { Salvaged, SalvagedItems, SalvagedOrNull, SalvagedOrOmitted } from '../domain/salvage.ts';
import type { Evidence, Repo, Task, TaskStage } from '../domain/types.ts';
import { EVIDENCE_STAGES, EVIDENCE_THEMES } from '../domain/verification.ts';
import { assembleReport } from './assemble.ts';
import { listPullRequestEvidence, resolvePublicUrl } from './pull-request.ts';
import type { ManualTestTargetKind, ReportCheck, ReviewFinding, WorkReport } from './types.ts';

export const REVIEW_PAYLOAD_VERSION = 1;

const REVIEW_EVIDENCE_KINDS = ['screenshot', 'recording', 'preview'] as const satisfies readonly Evidence['kind'][];

const FINDING_SEVERITIES = ['blocking', 'should_fix', 'optional'] as const satisfies readonly ReviewFinding['severity'][];

const CHECK_OUTCOMES = ['pass', 'fail', 'skipped'] as const satisfies readonly ReportCheck['outcome'][];

const TEST_TARGETS = ['url', 'file', 'command', 'screen'] as const satisfies readonly ManualTestTargetKind[];

const REVIEW_PAYLOAD_STAGES = ['shipping', 'awaiting_merge', 'merged', 'done'] as const satisfies readonly TaskStage[];

type ReviewEvidenceKind = (typeof REVIEW_EVIDENCE_KINDS)[number];

type ReviewPayloadStage = (typeof REVIEW_PAYLOAD_STAGES)[number];

const REPO_NAME = /^[\w.-]{1,100}$/;

const REPO_SLUG = /^[\w.-]+\/[\w.-]+$/;

const BRANCH_NAME = /^[\w./-]{1,200}$/;

const GITHUB_ATTACHMENT =
  /^https:\/\/(?:github\.com\/user-attachments\/|[a-z0-9-]+\.githubusercontent\.com\/)/;

const Filled = Schema.NonEmptyString;

const Absent = Salvaged(Schema.Null, () => null);

const NoSpots = Salvaged(Schema.mutable(Schema.Tuple([])), (): [] => []);

function Matching(pattern: RegExp) {
  return SalvagedOrNull(Schema.String.check(Schema.isPattern(pattern)));
}

const ReviewCheck = Schema.Struct({
  id: Filled,
  label: Filled,
  command: Schema.String,
  outcome: Schema.Literals(CHECK_OUTCOMES),
  detail: Absent,
});

const ReviewCall = Schema.Struct({
  title: Filled,
  call: Filled,
  reason: Salvaged(Schema.String, () => ''),
  file: Absent,
  line: Absent,
  end: Absent,
  alternatives: SalvagedItems(Schema.Struct({ option: Filled, rejected: Filled })),
});

const ReviewRisk = Schema.Struct({ title: Filled, risk: Filled, file: Absent, line: Absent, end: Absent });

const ReviewStep = Schema.Struct({
  action: Filled,
  expect: Filled,
  target: SalvagedOrNull(Schema.Struct({ kind: Schema.Literals(TEST_TARGETS), value: Filled })),
});

const ReviewWalkthrough = Schema.Struct({
  approach: Salvaged(Schema.String, () => ''),
  flow: Salvaged(Schema.String, () => ''),
  risks: SalvagedItems(ReviewRisk),
  testing: Salvaged(
    Schema.Struct({ automated: SalvagedItems(Schema.String), manual: SalvagedItems(ReviewStep) }),
    () => ({ automated: [], manual: [] })
  ),
});

const ReviewReport = Schema.Struct({
  headline: Salvaged(Schema.String, () => ''),
  sections: SalvagedItems(Schema.Struct({ title: Filled, summary: Filled, spots: NoSpots })),
  checks: SalvagedItems(ReviewCheck),
  judgementCalls: SalvagedItems(ReviewCall),
  walkthrough: SalvagedOrNull(ReviewWalkthrough),
});

export const ReviewPayloadEvidence = Schema.Struct({
  id: Filled,
  itemId: Filled,
  kind: Schema.Literals(REVIEW_EVIDENCE_KINDS),
  title: Filled,
  url: Schema.String.check(Schema.isPattern(GITHUB_ATTACHMENT)),
  detail: SalvagedOrNull(Schema.String),
  width: SalvagedOrNull(Schema.Finite),
  theme: SalvagedOrNull(Schema.Literals(EVIDENCE_THEMES)),
  stage: SalvagedOrNull(Schema.Literals(EVIDENCE_STAGES)),
  label: SalvagedOrNull(Schema.String),
});

export type ReviewPayloadEvidence = typeof ReviewPayloadEvidence.Type;

const ReviewCoverage = Schema.Struct({
  covered: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  executable: Schema.Finite,
}).check(Schema.makeFilter(({ covered, executable }) => covered <= executable));

const ReviewFindingSchema = Schema.Struct({
  severity: Schema.Literals(FINDING_SEVERITIES),
  file: Absent,
  line: Absent,
  title: SalvagedOrOmitted(Filled),
  message: Filled,
});

const ReviewVerdict = Schema.Struct({ summary: Schema.String, findings: SalvagedItems(ReviewFindingSchema) });

const ReviewTask = Schema.Struct({
  id: Filled,
  handle: SalvagedOrNull(Schema.String),
  title: Filled,
  summary: SalvagedOrNull(Schema.String),
  pullRequest: SalvagedOrNull(Schema.Int.check(Schema.isGreaterThan(0))),
  repo: Matching(REPO_NAME),
  slug: Matching(REPO_SLUG),
  branch: Matching(BRANCH_NAME),
  coverage: SalvagedOrNull(ReviewCoverage),
  stage: Salvaged(Schema.Literals(REVIEW_PAYLOAD_STAGES), (): ReviewPayloadStage => 'shipping'),
  startedAt: SalvagedOrNull(Schema.Finite),
});

export const ReviewPayload = Schema.Struct({
  v: Schema.Literal(REVIEW_PAYLOAD_VERSION),
  task: ReviewTask,
  report: ReviewReport,
  evidence: SalvagedItems(ReviewPayloadEvidence),
  review: SalvagedOrNull(ReviewVerdict),
});

export type ReviewPayload = Omit<typeof ReviewPayload.Type, 'report'> & { report: WorkReport };

type ReviewPayloadCoverage = typeof ReviewCoverage.Type;

type ReviewPayloadVerdict = typeof ReviewVerdict.Type;

function resolvePayloadStage(stage: TaskStage): ReviewPayloadStage {
  return REVIEW_PAYLOAD_STAGES.find((known) => known === stage) ?? 'shipping';
}

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

const decodeReviewPayload = Schema.decodeUnknownOption(ReviewPayload);

export function parseReviewPayload(value: unknown): ReviewPayload | null {
  return Option.getOrNull(decodeReviewPayload(value));
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
