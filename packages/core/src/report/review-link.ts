import type { Evidence, EvidenceStage, EvidenceTheme, Task } from '../domain/types.ts';
import { EVIDENCE_STAGES, EVIDENCE_THEMES } from '../domain/verification.ts';
import { assembleReport } from './assemble.ts';
import { listPullRequestEvidence, resolvePublicUrl } from './pull-request.ts';
import type {
  JudgementCall,
  ManualTestStep,
  ReportCheck,
  ReportRisk,
  ReportWalkthrough,
  WorkReport,
} from './types.ts';

export const REVIEW_PAYLOAD_VERSION = 1;

type ReviewEvidenceKind = Extract<Evidence['kind'], 'screenshot' | 'recording' | 'preview'>;

const REVIEW_EVIDENCE_KINDS: readonly ReviewEvidenceKind[] = ['screenshot', 'recording', 'preview'];

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
  task: { id: string; handle: string | null; title: string; summary: string | null };
  report: WorkReport;
  evidence: ReviewPayloadEvidence[];
}

function isReviewEvidenceKind(kind: Evidence['kind']): kind is ReviewEvidenceKind {
  return (REVIEW_EVIDENCE_KINDS as readonly string[]).includes(kind);
}

function listPayloadEvidence(task: Task, evidence: readonly Evidence[]): ReviewPayloadEvidence[] {
  return listPullRequestEvidence(task, evidence).flatMap((item) =>
    item.parts.flatMap((part) => {
      const url = resolvePublicUrl(part);
      if (!url || !isReviewEvidenceKind(part.kind)) return [];
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

export function serializeReviewPayload(task: Task, evidence: readonly Evidence[]): ReviewPayload {
  const report = assembleReport(task);
  const walkthrough = report.walkthrough
    ? {
        ...report.walkthrough,
        risks: report.walkthrough.risks.map((risk) => ({ ...risk, file: null, line: null, end: null })),
      }
    : null;
  return {
    v: REVIEW_PAYLOAD_VERSION,
    task: { id: task.id, handle: task.handle ?? null, title: task.title, summary: task.summary },
    report: {
      ...report,
      sections: report.sections.map((section) => ({ ...section, spots: [] })),
      judgementCalls: report.judgementCalls.map((call) => ({ ...call, file: null, line: null, end: null })),
      walkthrough,
    },
    evidence: listPayloadEvidence(task, evidence),
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
  return { id, label, command, outcome, detail: readText(fields, 'detail') };
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
  if (!id || !itemId || !kind || !title || !url || !/^https?:\/\//.test(url)) return null;
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

export function parseReviewPayload(value: unknown): ReviewPayload | null {
  if (!isFields(value) || value.v !== REVIEW_PAYLOAD_VERSION) return null;
  if (!isFields(value.task) || !isFields(value.report)) return null;
  const id = readText(value.task, 'id');
  const title = readText(value.task, 'title');
  if (!id || !title) return null;
  return {
    v: REVIEW_PAYLOAD_VERSION,
    task: { id, handle: readText(value.task, 'handle'), title, summary: readText(value.task, 'summary') },
    report: parseReport(value.report),
    evidence: listFields(value.evidence).flatMap((piece) => parseEvidence(piece) ?? []),
  };
}
