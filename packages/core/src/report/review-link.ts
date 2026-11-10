import { Option, Schema } from 'effect';
import type { Evidence, Repo, Task, TaskStage } from '../domain/types.ts';
import { assembleReport } from './assemble.ts';
import { listPullRequestEvidence, resolvePublicUrl } from './pull-request.ts';
import {
  GITHUB_ATTACHMENT,
  REPO_SLUG,
  REVIEW_EVIDENCE_KINDS,
  REVIEW_PAYLOAD_STAGES,
  REVIEW_PAYLOAD_VERSION,
  type ReviewEvidenceKind,
  ReviewPayload,
  type ReviewPayloadCoverage,
  type ReviewPayloadEvidence,
  type ReviewPayloadStage,
  type ReviewPayloadVerdict,
} from './schema.ts';

function resolvePayloadStage(stage: TaskStage): ReviewPayloadStage {
  return REVIEW_PAYLOAD_STAGES.find((known) => known === stage) ?? 'shipping';
}

function isReviewEvidenceKind(kind: Evidence['kind']): kind is ReviewEvidenceKind {
  return (REVIEW_EVIDENCE_KINDS as readonly string[]).includes(kind);
}

function listPayloadEvidence(task: Task, evidence: readonly Evidence[]): ReviewPayloadEvidence[] {
  return listPullRequestEvidence(task, evidence).flatMap((item) =>
    item.parts.flatMap((part) => {
      const url = Option.getOrNull(resolvePublicUrl(part));
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

export function parseReviewPayload(value: unknown): Option.Option<ReviewPayload> {
  return decodeReviewPayload(value);
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
