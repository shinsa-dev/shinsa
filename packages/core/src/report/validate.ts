import type { ChangeProposalInput, InquiryShape } from '../commands/index.ts';
import {
  COMPOSABLE_STEPS,
  type DeliveringStep,
  EVIDENCE_KINDS,
  EVIDENCE_STAGES,
  EVIDENCE_THEMES,
  type PipelineStep,
  PLAN_EVIDENCE_KINDS,
  SHAPE_LIMITS,
} from '../domain/index.ts';
import type { EvidenceItemKind } from '../domain/types.ts';
import { createTesting, isWebUrl, MANUAL_TEST_TARGETS, parseTestFile } from './testing.ts';
import type {
  Attention,
  CodeSpot,
  ComparisonPartHandOver,
  EvidenceHandOver,
  EvidenceSource,
  FixHandOver,
  JudgementAlternative,
  JudgementCall,
  ManualTestStep,
  ManualTestTarget,
  MergeStep,
  MergeStepKind,
  MergeStepTiming,
  PhaseHandOver,
  PlanDocument,
  PlanHandOver,
  QuestionHandOver,
  ReportRisk,
  ReportTesting,
  ReportWalkthrough,
  ReportWalkthroughRevision,
  ReviewFinding,
  ReviewHandOver,
  SuggestedTask,
  WaitHandOver,
  WatchdogSource,
  WatchdogSourceRequest,
  WatchdogSpec,
  WatchReport,
} from './types.ts';

export const PROTOCOL_LIMITS = {
  phaseSummary: 240,
  spots: 8,
  why: 180,
  spotTitle: 80,
  explain: 400,
  judgementCalls: 5,
  callTitle: 60,
  call: 120,
  reason: 240,
  alternatives: 3,
  alternativeOption: 100,
  alternativeRejected: 200,
  walkthroughApproach: 1_200,
  flow: 2_400,
  risks: 8,
  riskTitle: 60,
  risk: 280,
  testingAutomated: 4,
  testingAutomatedItem: 240,
  testingSteps: 10,
  testingAction: 240,
  testingExpect: 240,
  testingTarget: 400,
  mergeSteps: 8,
  mergeStepTitle: 80,
  mergeStepDetail: 400,
  mergeStepCommand: 400,
  watchdogs: 5,
  watchdogTitle: 80,
  watchdogCheck: 600,
  watchdogServer: 128,
  watchdogData: 200,
  watchdogEvidence: 300,
  watchdogSuggestions: 4,
  watchdogSuggestion: 160,
  watchdogEveryHours: 24,
  watchdogForHours: 168,
  watchSummary: 600,
  watchIssueTitle: 80,
  watchIssueRequest: 2_000,
  disagreements: 8,
  disagreement: 280,
  goal: 300,
  minPlanPhases: 2,
  planPhases: 8,
  planTitle: 60,
  planDetail: 160,
  behaviour: 8,
  behaviourItem: 200,
  approach: 700,
  files: 20,
  fileChange: 140,
  listItems: 6,
  listItem: 200,
  questions: 4,
  question: 200,
  options: 4,
  option: 100,
  findingCount: 12,
  finding: 280,
  findingTitle: 80,
  findingFix: 600,
  reviewSummary: 400,
  path: 300,
  changeSummary: 240,
  questionContext: 2_000,
  suggestions: 5,
  suggestionTitle: 80,
  suggestionRequest: 2_000,
  suggestionWhy: 200,
  waitNotes: 500,
  waitCheckMinutes: 24 * 60,
  waitTimeoutMinutes: 7 * 24 * 60,
  waitAttempts: 100,
  impact: 1_000,
  planChecks: 6,
  checkCommand: 200,
  evidenceTitle: 80,
  evidenceDetail: 280,
  evidenceWidth: 7_680,
  evidenceText: 40_000,
  evidenceUrl: 2_000,
  evidenceParts: 6,
  evidenceLabel: 40,
} as const;

export const ATTACHED_EVIDENCE_KINDS: readonly [EvidenceItemKind, ...EvidenceItemKind[]] = [
  ...EVIDENCE_KINDS,
  'comparison',
];

export const MERGE_STEP_TIMINGS: readonly [MergeStepTiming, ...MergeStepTiming[]] = [
  'pre_merge',
  'post_merge',
];

export const MERGE_STEP_KINDS: readonly [MergeStepKind, ...MergeStepKind[]] = [
  'env',
  'secret',
  'migration',
  'deploy',
  'config',
  'other',
];

export const ATTENTION_LEVELS: readonly [Attention, ...Attention[]] = ['critical', 'high', 'normal'];

export const FINDING_SEVERITIES: readonly [ReviewFinding['severity'], ...ReviewFinding['severity'][]] = [
  'blocking',
  'suggestion',
];

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export class Reader {
  readonly errors: string[] = [];

  text(value: unknown, path: string, max: number): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      this.errors.push(`${path} is required.`);
      return '';
    }
    const text = value.trim();
    if (text.length > max) this.errors.push(`${path} is ${text.length} characters; the limit is ${max}.`);
    return text;
  }

  optionalText(value: unknown, path: string, max: number): string | null {
    if (value === undefined || value === null || value === '') return null;
    return this.text(value, path, max);
  }

  list(value: unknown, path: string, max: number, min = 0): unknown[] {
    if (value === undefined && min === 0) return [];
    if (!Array.isArray(value)) {
      this.errors.push(`${path} must be a list.`);
      return [];
    }
    if (value.length < min) this.errors.push(`${path} needs at least ${min} item${min === 1 ? '' : 's'}.`);
    if (value.length > max) this.errors.push(`${path} has ${value.length} items; the limit is ${max}.`);
    return value.slice(0, max);
  }

  record(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      this.errors.push(`${path} must be an object.`);
      return {};
    }
    return value as Record<string, unknown>;
  }

  line(value: unknown, path: string): number {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
    this.errors.push(`${path} must be a line number (1 or more).`);
    return 0;
  }

  optionalLine(value: unknown, path: string): number | null {
    if (value === undefined || value === null) return null;
    return this.line(value, path);
  }

  range(start: number | null, end: number | null, path: string, startName: string) {
    if (start !== null && end !== null && end < start) {
      this.errors.push(`${path}.end comes before ${path}.${startName}.`);
    }
  }

  count(value: unknown, path: string, max: number): number {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max) return value;
    this.errors.push(`${path} must be a whole number from 1 to ${max}.`);
    return 1;
  }

  optionalCount(value: unknown, path: string, max: number): number | null {
    if (value === undefined || value === null) return null;
    return this.count(value, path, max);
  }

  flag(value: unknown, path: string): boolean {
    if (value === undefined) return false;
    if (typeof value === 'boolean') return value;
    this.errors.push(`${path} must be true or false.`);
    return false;
  }

  pick<T extends string>(value: unknown, path: string, allowed: readonly [T, ...T[]]): T {
    const match = allowed.find((option) => option === value);
    if (match !== undefined) return match;
    this.errors.push(`${path} must be one of ${allowed.join(', ')}.`);
    return allowed[0];
  }

  result<T>(value: T): Validation<T> {
    return this.errors.length === 0 ? { ok: true, value } : { ok: false, errors: this.errors };
  }
}

function readSpot(reader: Reader, raw: unknown, path: string): CodeSpot {
  const record = reader.record(raw, path);
  const start = reader.line(record.start, `${path}.start`);
  const end = reader.optionalLine(record.end, `${path}.end`) ?? start;
  reader.range(start, end, path, 'start');
  const title = reader.optionalText(record.title, `${path}.title`, PROTOCOL_LIMITS.spotTitle);
  const explain = reader.optionalText(record.explain, `${path}.explain`, PROTOCOL_LIMITS.explain);
  return {
    file: reader.text(record.file, `${path}.file`, PROTOCOL_LIMITS.path),
    start,
    end,
    attention: reader.pick(record.attention, `${path}.attention`, ATTENTION_LEVELS),
    why: reader.text(record.why, `${path}.why`, PROTOCOL_LIMITS.why),
    ...(title === null ? {} : { title }),
    ...(explain === null ? {} : { explain }),
  };
}

function readSpots(reader: Reader, value: unknown, path: string) {
  return reader
    .list(value, path, PROTOCOL_LIMITS.spots)
    .map((spot, index) => readSpot(reader, spot, `${path}[${index}]`));
}

function readAlternatives(reader: Reader, value: unknown, path: string): JudgementAlternative[] {
  return reader.list(value, path, PROTOCOL_LIMITS.alternatives).map((raw, index) => {
    const record = reader.record(raw, `${path}[${index}]`);
    return {
      option: reader.text(record.option, `${path}[${index}].option`, PROTOCOL_LIMITS.alternativeOption),
      rejected: reader.text(
        record.rejected,
        `${path}[${index}].rejected`,
        PROTOCOL_LIMITS.alternativeRejected
      ),
    };
  });
}

function readJudgementCalls(reader: Reader, value: unknown): JudgementCall[] {
  return reader.list(value, 'judgement_calls', PROTOCOL_LIMITS.judgementCalls).map((raw, index) => {
    const path = `judgement_calls[${index}]`;
    const record = reader.record(raw, path);
    const line = reader.optionalLine(record.line, `${path}.line`);
    const end = reader.optionalLine(record.end, `${path}.end`);
    reader.range(line, end, path, 'line');
    const alternatives = readAlternatives(reader, record.alternatives, `${path}.alternatives`);
    return {
      title: reader.text(record.title, `${path}.title`, PROTOCOL_LIMITS.callTitle),
      call: reader.text(record.call, `${path}.call`, PROTOCOL_LIMITS.call),
      reason: reader.text(record.reason, `${path}.reason`, PROTOCOL_LIMITS.reason),
      file: reader.optionalText(record.file, `${path}.file`, PROTOCOL_LIMITS.path),
      line,
      ...(end === null ? {} : { end }),
      ...(alternatives.length > 0 ? { alternatives } : {}),
    };
  });
}

function readRisks(reader: Reader, value: unknown): ReportRisk[] {
  return reader.list(value, 'walkthrough.risks', PROTOCOL_LIMITS.risks).map((raw, index) => {
    const path = `walkthrough.risks[${index}]`;
    const record = reader.record(raw, path);
    const line = reader.optionalLine(record.line, `${path}.line`);
    const end = reader.optionalLine(record.end, `${path}.end`);
    reader.range(line, end, path, 'line');
    return {
      title: reader.text(record.title, `${path}.title`, PROTOCOL_LIMITS.riskTitle),
      risk: reader.text(record.risk, `${path}.risk`, PROTOCOL_LIMITS.risk),
      file: reader.optionalText(record.file, `${path}.file`, PROTOCOL_LIMITS.path),
      line,
      end,
    };
  });
}

function readApproach(reader: Reader, value: unknown) {
  return reader.text(value, 'walkthrough.approach', PROTOCOL_LIMITS.walkthroughApproach);
}

function readFlow(reader: Reader, value: unknown) {
  return reader.text(value, 'walkthrough.flow', PROTOCOL_LIMITS.flow);
}

function readTestTarget(reader: Reader, value: unknown, path: string): ManualTestTarget | null {
  if (!isGiven(value)) return null;
  const record = reader.record(value, path);
  const kind = reader.pick(record.kind, `${path}.kind`, MANUAL_TEST_TARGETS);
  const text = reader.text(record.value, `${path}.value`, PROTOCOL_LIMITS.testingTarget);
  if (text && kind === 'url' && !isWebUrl(text)) {
    reader.errors.push(`${path}.value must be an http or https URL.`);
  }
  if (text && kind === 'file' && !parseTestFile(text)) {
    reader.errors.push(
      `${path}.value must be a path relative to the repository root, with :line or :start-end when it points at lines.`
    );
  }
  return { kind, value: text };
}

function readManualSteps(reader: Reader, value: unknown, path: string): ManualTestStep[] {
  return reader.list(value, path, PROTOCOL_LIMITS.testingSteps).map((raw, index) => {
    const step = `${path}[${index}]`;
    const record = reader.record(raw, step);
    return {
      action: reader.text(record.action, `${step}.action`, PROTOCOL_LIMITS.testingAction),
      target: readTestTarget(reader, record.target, `${step}.target`),
      expect: reader.text(record.expect, `${step}.expect`, PROTOCOL_LIMITS.testingExpect),
    };
  });
}

function readAutomatedTesting(reader: Reader, value: unknown, path: string) {
  return readTextList(
    reader,
    value,
    path,
    PROTOCOL_LIMITS.testingAutomated,
    PROTOCOL_LIMITS.testingAutomatedItem
  );
}

function readTesting(reader: Reader, value: unknown): ReportTesting {
  if (Array.isArray(value)) return createTesting(readAutomatedTesting(reader, value, 'walkthrough.testing'));
  if (!isGiven(value)) return createTesting();
  const record = reader.record(value, 'walkthrough.testing');
  return {
    automated: readAutomatedTesting(reader, record.automated, 'walkthrough.testing.automated'),
    manual: readManualSteps(reader, record.manual, 'walkthrough.testing.manual'),
  };
}

function readMergeStep(reader: Reader, raw: unknown, path: string): MergeStep {
  const record = reader.record(raw, path);
  return {
    when: reader.pick(record.when, `${path}.when`, MERGE_STEP_TIMINGS),
    kind: reader.pick(record.kind, `${path}.kind`, MERGE_STEP_KINDS),
    title: reader.text(record.title, `${path}.title`, PROTOCOL_LIMITS.mergeStepTitle),
    detail: reader.text(record.detail, `${path}.detail`, PROTOCOL_LIMITS.mergeStepDetail),
    command: reader.optionalText(record.command, `${path}.command`, PROTOCOL_LIMITS.mergeStepCommand),
  };
}

function readMergeSteps(reader: Reader, value: unknown) {
  const steps = reader
    .list(value, 'walkthrough.steps', PROTOCOL_LIMITS.mergeSteps)
    .map((raw, index) => readMergeStep(reader, raw, `walkthrough.steps[${index}]`));
  steps.forEach((step, index) => {
    const first = steps.findIndex((other) => other.when === step.when && other.title === step.title);
    if (first < index) {
      reader.errors.push(
        `walkthrough.steps[${index}].title repeats walkthrough.steps[${first}]; give each step its own title.`
      );
    }
  });
  return steps;
}

function readWatchdogSource(reader: Reader, value: unknown, path: string): WatchdogSource | null {
  if (!isGiven(value)) return null;
  const record = reader.record(value, path);
  return {
    server: reader.text(record.server, `${path}.server`, PROTOCOL_LIMITS.watchdogServer),
    data: reader.text(record.data, `${path}.data`, PROTOCOL_LIMITS.watchdogData),
  };
}

function readSourceRequest(reader: Reader, value: unknown, path: string): WatchdogSourceRequest | null {
  if (!isGiven(value)) return null;
  const record = reader.record(value, path);
  const suggestions = readTextList(
    reader,
    record.suggestions,
    `${path}.suggestions`,
    PROTOCOL_LIMITS.watchdogSuggestions,
    PROTOCOL_LIMITS.watchdogSuggestion
  );
  if (suggestions.length === 0) {
    reader.errors.push(
      `${path}.suggestions needs at least 1 server to connect, by name and where it comes from.`
    );
  }
  return {
    data: reader.text(record.data, `${path}.data`, PROTOCOL_LIMITS.watchdogData),
    evidence: reader.text(record.evidence, `${path}.evidence`, PROTOCOL_LIMITS.watchdogEvidence),
    suggestions,
  };
}

function readWatchdog(reader: Reader, raw: unknown, path: string): WatchdogSpec {
  const record = reader.record(raw, path);
  const source = readWatchdogSource(reader, record.source, `${path}.source`);
  const sourceRequest = readSourceRequest(reader, record.source_request, `${path}.source_request`);
  if ((source === null) === (sourceRequest === null)) {
    reader.errors.push(
      `${path} needs exactly one of source (a server that has the data) or source_request (what to connect).`
    );
  }
  return {
    title: reader.text(record.title, `${path}.title`, PROTOCOL_LIMITS.watchdogTitle),
    check: reader.text(record.check, `${path}.check`, PROTOCOL_LIMITS.watchdogCheck),
    source,
    sourceRequest,
    everyHours: reader.count(record.every_hours, `${path}.every_hours`, PROTOCOL_LIMITS.watchdogEveryHours),
    forHours: reader.count(record.for_hours, `${path}.for_hours`, PROTOCOL_LIMITS.watchdogForHours),
  };
}

function readWatchdogs(reader: Reader, value: unknown) {
  const watchdogs = reader
    .list(value, 'walkthrough.watchdogs', PROTOCOL_LIMITS.watchdogs)
    .map((raw, index) => readWatchdog(reader, raw, `walkthrough.watchdogs[${index}]`));
  watchdogs.forEach((watchdog, index) => {
    const first = watchdogs.findIndex((other) => other.title === watchdog.title);
    if (first < index) {
      reader.errors.push(
        `walkthrough.watchdogs[${index}].title repeats walkthrough.watchdogs[${first}]; give each watchdog its own title.`
      );
    }
    if (watchdog.everyHours > watchdog.forHours) {
      reader.errors.push(
        `walkthrough.watchdogs[${index}] checks every ${watchdog.everyHours} hours but watches for only ${watchdog.forHours}; check at least once in the window.`
      );
    }
  });
  return watchdogs;
}

function resolveGivenWatchdogs(reader: Reader, value: unknown, empty: boolean) {
  if (!isGiven(value)) return {};
  const watchdogs = readWatchdogs(reader, value);
  return watchdogs.length > 0 || empty ? { watchdogs } : {};
}

function isGiven(value: unknown) {
  return value !== undefined && value !== null;
}

function readWalkthrough(reader: Reader, value: unknown): ReportWalkthrough | null {
  if (!isGiven(value)) return null;
  const record = reader.record(value, 'walkthrough');
  return {
    approach: readApproach(reader, record.approach),
    flow: readFlow(reader, record.flow),
    risks: readRisks(reader, record.risks),
    testing: readTesting(reader, record.testing),
    ...resolveGivenSteps(reader, record.steps, false),
    ...resolveGivenWatchdogs(reader, record.watchdogs, false),
  };
}

function resolveGivenSteps(reader: Reader, value: unknown, empty: boolean) {
  if (!isGiven(value)) return {};
  const steps = readMergeSteps(reader, value);
  return steps.length > 0 || empty ? { steps } : {};
}

function readWalkthroughRevision(reader: Reader, value: unknown): ReportWalkthroughRevision | null {
  if (!isGiven(value)) return null;
  const errors = reader.errors.length;
  const record = reader.record(value, 'walkthrough');
  if (reader.errors.length > errors) return null;
  const revision: ReportWalkthroughRevision = {
    ...(isGiven(record.approach) ? { approach: readApproach(reader, record.approach) } : {}),
    ...(isGiven(record.flow) ? { flow: readFlow(reader, record.flow) } : {}),
    ...(isGiven(record.risks) ? { risks: readRisks(reader, record.risks) } : {}),
    ...(isGiven(record.testing) ? { testing: readTesting(reader, record.testing) } : {}),
    ...resolveGivenSteps(reader, record.steps, true),
    ...resolveGivenWatchdogs(reader, record.watchdogs, true),
  };
  if (Object.keys(revision).length === 0) {
    reader.errors.push(
      'walkthrough needs at least one of approach, flow, risks, testing, steps or watchdogs. Leave it out when the fix changes none of them.'
    );
  }
  return revision;
}

function readTextList(reader: Reader, value: unknown, path: string, max: number, itemMax: number) {
  return reader.list(value, path, max).map((item, index) => reader.text(item, `${path}[${index}]`, itemMax));
}

export function validatePhaseHandOver(input: Record<string, unknown>): Validation<PhaseHandOver> {
  const reader = new Reader();
  return reader.result({
    summary: reader.text(input.summary, 'summary', PROTOCOL_LIMITS.phaseSummary),
    spots: readSpots(reader, input.spots, 'spots'),
    judgementCalls: readJudgementCalls(reader, input.judgement_calls),
    walkthrough: readWalkthrough(reader, input.walkthrough),
  });
}

export function validateFixHandOver(input: Record<string, unknown>): Validation<FixHandOver> {
  const reader = new Reader();
  return reader.result({
    summary: reader.text(input.summary, 'summary', PROTOCOL_LIMITS.phaseSummary),
    walkthrough: readWalkthroughRevision(reader, input.walkthrough),
  });
}

function readPlanFiles(reader: Reader, input: unknown) {
  return reader.list(input, 'files', PROTOCOL_LIMITS.files).map((raw, index) => {
    const path = `files[${index}]`;
    const record = reader.record(raw, path);
    return {
      path: reader.text(record.path, `${path}.path`, PROTOCOL_LIMITS.path),
      change: reader.text(record.change, `${path}.change`, PROTOCOL_LIMITS.fileChange),
    };
  });
}

function readPlanQuestions(reader: Reader, input: unknown) {
  return reader.list(input, 'questions', PROTOCOL_LIMITS.questions).map((raw, index) => {
    const path = `questions[${index}]`;
    const record = reader.record(raw, path);
    return {
      question: reader.text(record.question, `${path}.question`, PROTOCOL_LIMITS.question),
      options: readTextList(
        reader,
        record.options,
        `${path}.options`,
        PROTOCOL_LIMITS.options,
        PROTOCOL_LIMITS.option
      ),
      recommendation: reader.optionalText(
        record.recommendation,
        `${path}.recommendation`,
        PROTOCOL_LIMITS.option
      ),
    };
  });
}

function readPlanPhases(reader: Reader, input: unknown) {
  const phases = reader.list(input, 'phases', PROTOCOL_LIMITS.planPhases).map((raw, index) => {
    const path = `phases[${index}]`;
    const record = reader.record(raw, path);
    return {
      title: reader.text(record.title, `${path}.title`, PROTOCOL_LIMITS.planTitle),
      detail: reader.text(record.detail, `${path}.detail`, PROTOCOL_LIMITS.planDetail),
    };
  });
  if (phases.length < PROTOCOL_LIMITS.minPlanPhases) {
    reader.errors.push(`phases: at least ${PROTOCOL_LIMITS.minPlanPhases} phases.`);
  }
  return phases;
}

function readPlanOperation(reader: Reader, input: unknown): Partial<PlanDocument> {
  if (input === undefined) return {};
  return {
    operation: readTextList(reader, input, 'operation', PROTOCOL_LIMITS.planPhases, PROTOCOL_LIMITS.listItem),
  };
}

function validatePlanDocument(input: Record<string, unknown>): Validation<PlanDocument> {
  const reader = new Reader();
  const files = readPlanFiles(reader, input.files);
  const questions = readPlanQuestions(reader, input.questions);
  const phases = readPlanPhases(reader, input.phases);
  const { listItems, listItem } = PROTOCOL_LIMITS;
  return reader.result({
    goal: reader.text(input.goal, 'goal', PROTOCOL_LIMITS.goal),
    phases,
    behaviour: readTextList(
      reader,
      input.behaviour,
      'behaviour',
      PROTOCOL_LIMITS.behaviour,
      PROTOCOL_LIMITS.behaviourItem
    ),
    approach: reader.text(input.approach, 'approach', PROTOCOL_LIMITS.approach),
    files,
    outOfScope: readTextList(reader, input.out_of_scope, 'out_of_scope', listItems, listItem),
    verification: readTextList(reader, input.verification, 'verification', listItems, listItem),
    questions,
    ...readPlanOperation(reader, input.operation),
    ...readPlanParameters(reader, input),
  });
}

function readPlanParameters(reader: Reader, input: Record<string, unknown>): Partial<PlanDocument> {
  const impact = reader.optionalText(input.impact, 'impact', PROTOCOL_LIMITS.impact);
  const evidence = reader
    .list(input.evidence, 'evidence', PLAN_EVIDENCE_KINDS.length)
    .map((kind, index) => reader.pick(kind, `evidence[${index}]`, PLAN_EVIDENCE_KINDS));
  if (new Set(evidence).size !== evidence.length) reader.errors.push('evidence names a kind twice.');
  const checks = readTextList(
    reader,
    input.checks,
    'checks',
    PROTOCOL_LIMITS.planChecks,
    PROTOCOL_LIMITS.checkCommand
  );
  return {
    ...(impact === null ? {} : { impact }),
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(checks.length > 0 ? { checks } : {}),
    ...(reader.flag(input.approval, 'approval') ? { approval: true } : {}),
  };
}

function readDisagreements(reader: Reader, value: unknown) {
  const disagreements = reader
    .list(value, 'disagreements', PROTOCOL_LIMITS.disagreements)
    .map((raw, index) => {
      const path = `disagreements[${index}]`;
      const record = reader.record(raw, path);
      return {
        call: reader.count(
          record.call,
          `${path}.call`,
          PROTOCOL_LIMITS.judgementCalls * PROTOCOL_LIMITS.planPhases
        ),
        reason: reader.text(record.reason, `${path}.reason`, PROTOCOL_LIMITS.disagreement),
      };
    });
  const calls = disagreements.map((entry) => entry.call);
  if (new Set(calls).size !== calls.length) reader.errors.push('disagreements names a judgement call twice.');
  return disagreements;
}

export function validateReview(input: Record<string, unknown>): Validation<ReviewHandOver> {
  const reader = new Reader();
  const summary = reader.optionalText(input.summary, 'summary', PROTOCOL_LIMITS.reviewSummary);
  const findings = reader.list(input.findings, 'findings', PROTOCOL_LIMITS.findingCount).map((raw, index) => {
    const path = `findings[${index}]`;
    const record = reader.record(raw, path);
    const line = reader.optionalLine(record.line, `${path}.line`);
    const end = reader.optionalLine(record.end, `${path}.end`) ?? line;
    reader.range(line, end, path, 'line');
    const title = reader.optionalText(record.title, `${path}.title`, PROTOCOL_LIMITS.findingTitle);
    const fix = reader.optionalText(record.fix, `${path}.fix`, PROTOCOL_LIMITS.findingFix);
    return {
      severity: reader.pick(record.severity, `${path}.severity`, FINDING_SEVERITIES),
      file: reader.optionalText(record.file, `${path}.file`, PROTOCOL_LIMITS.path),
      line,
      end,
      ...(title === null ? {} : { title }),
      message: reader.text(record.message, `${path}.message`, PROTOCOL_LIMITS.finding),
      ...(fix === null ? {} : { fix }),
    };
  });
  return reader.result({ summary, findings, disagreements: readDisagreements(reader, input.disagreements) });
}

export function validatePlanHandOver(input: Record<string, unknown>): Validation<PlanHandOver> {
  const plan = validatePlanDocument(input);
  const reader = new Reader();
  const changeSummary = reader.optionalText(
    input.change_summary,
    'change_summary',
    PROTOCOL_LIMITS.changeSummary
  );
  if (!plan.ok) return { ok: false, errors: [...plan.errors, ...reader.errors] };
  return reader.result({ document: plan.value, changeSummary });
}

function readChoices(reader: Reader, input: Record<string, unknown>) {
  const choices = readTextList(
    reader,
    input.choices,
    'choices',
    PROTOCOL_LIMITS.options,
    PROTOCOL_LIMITS.option
  );
  if (choices.length === 1) reader.errors.push('choices needs at least 2 options, or none.');
  if (new Set(choices).size !== choices.length) reader.errors.push('choices must differ from each other.');
  const recommendation = reader.optionalText(input.recommendation, 'recommendation', PROTOCOL_LIMITS.option);
  if (recommendation !== null && !choices.includes(recommendation)) {
    reader.errors.push('recommendation must be one of the choices, worded the same.');
  }
  return { choices, recommendation };
}

export function validateQuestion(input: Record<string, unknown>): Validation<QuestionHandOver> {
  const reader = new Reader();
  return reader.result({
    question: reader.text(input.question, 'question', PROTOCOL_LIMITS.question),
    context: reader.optionalText(input.context, 'context', PROTOCOL_LIMITS.questionContext),
    ...readChoices(reader, input),
  });
}

function readEvidenceSource(reader: Reader, input: Record<string, unknown>): EvidenceSource {
  const path = reader.optionalText(input.path, 'path', PROTOCOL_LIMITS.path);
  const url = reader.optionalText(input.url, 'url', PROTOCOL_LIMITS.evidenceUrl);
  const text = reader.optionalText(input.text, 'text', PROTOCOL_LIMITS.evidenceText);
  const given = [path, url, text].filter((value) => value !== null).length;
  if (given !== 1) reader.errors.push('Give exactly one of path, url or text.');
  if (path !== null) return { path };
  return url !== null ? { url } : { text: text ?? '' };
}

function readOptionalPick<T extends string>(
  reader: Reader,
  value: unknown,
  path: string,
  allowed: readonly [T, ...T[]]
): T | null {
  if (value === undefined || value === null || value === '') return null;
  return reader.pick(value, path, allowed);
}

function readEvidenceFacts(reader: Reader, input: Record<string, unknown>) {
  return {
    title: reader.text(input.title, 'title', PROTOCOL_LIMITS.evidenceTitle),
    detail: reader.optionalText(input.detail, 'detail', PROTOCOL_LIMITS.evidenceDetail),
    width: reader.optionalCount(input.width, 'width', PROTOCOL_LIMITS.evidenceWidth),
    theme: readOptionalPick(reader, input.theme, 'theme', EVIDENCE_THEMES),
  };
}

function readComparisonPart(reader: Reader, value: unknown, path: string): ComparisonPartHandOver {
  const record = reader.record(value, path);
  const part = {
    path: reader.text(record.path, `${path}.path`, PROTOCOL_LIMITS.path),
    stage: readOptionalPick(reader, record.stage, `${path}.stage`, EVIDENCE_STAGES),
    label: reader.optionalText(record.label, `${path}.label`, PROTOCOL_LIMITS.evidenceLabel),
  };
  if (part.stage === null && part.label === null) reader.errors.push(`${path} needs a stage or a label.`);
  return part;
}

function readComparisonParts(reader: Reader, input: Record<string, unknown>) {
  const parts = reader
    .list(input.parts, 'parts', PROTOCOL_LIMITS.evidenceParts, 2)
    .map((part, index) => readComparisonPart(reader, part, `parts[${index}]`));
  const names = parts.map((part) => part.label ?? part.stage);
  if (new Set(names).size !== names.length) {
    reader.errors.push('Each part needs its own stage or label; two parts are named the same.');
  }
  if (['path', 'url', 'text', 'stage'].some((field) => input[field] !== undefined && input[field] !== null)) {
    reader.errors.push('A comparison takes its files in parts: leave out path, url, text and stage.');
  }
  return parts;
}

export function validateEvidence(input: Record<string, unknown>): Validation<EvidenceHandOver> {
  const reader = new Reader();
  const kind = reader.pick(input.kind, 'kind', ATTACHED_EVIDENCE_KINDS);
  if (kind === 'comparison') {
    return reader.result<EvidenceHandOver>({
      kind,
      ...readEvidenceFacts(reader, input),
      parts: readComparisonParts(reader, input),
    });
  }
  if (input.parts !== undefined && input.parts !== null)
    reader.errors.push('parts is only for kind comparison.');
  return reader.result<EvidenceHandOver>({
    kind,
    ...readEvidenceFacts(reader, input),
    stage: readOptionalPick(reader, input.stage, 'stage', EVIDENCE_STAGES),
    source: readEvidenceSource(reader, input),
  });
}

export function validateWait(input: Record<string, unknown>): Validation<WaitHandOver> {
  const reader = new Reader();
  return reader.result({
    checkInMinutes: reader.count(
      input.check_in_minutes,
      'check_in_minutes',
      PROTOCOL_LIMITS.waitCheckMinutes
    ),
    notes: reader.text(input.notes, 'notes', PROTOCOL_LIMITS.waitNotes),
    timeoutMinutes: reader.optionalCount(
      input.timeout_minutes,
      'timeout_minutes',
      PROTOCOL_LIMITS.waitTimeoutMinutes
    ),
    maxAttempts: reader.optionalCount(input.max_attempts, 'max_attempts', PROTOCOL_LIMITS.waitAttempts),
  });
}

export function validateSuggestions(input: Record<string, unknown>): Validation<SuggestedTask[]> {
  const reader = new Reader();
  const tasks = reader.list(input.tasks, 'tasks', PROTOCOL_LIMITS.suggestions, 1).map((raw, index) => {
    const path = `tasks[${index}]`;
    const record = reader.record(raw, path);
    return {
      title: reader.text(record.title, `${path}.title`, PROTOCOL_LIMITS.suggestionTitle),
      request: reader.text(record.request, `${path}.request`, PROTOCOL_LIMITS.suggestionRequest),
      why: reader.text(record.why, `${path}.why`, PROTOCOL_LIMITS.suggestionWhy),
      waitsOnThis: reader.flag(record.after_this, `${path}.after_this`),
      ...(reader.flag(record.split_off, `${path}.split_off`) ? { splitOff: true } : {}),
    };
  });
  return reader.result(tasks);
}

function readProposal(reader: Reader, value: unknown): ChangeProposalInput | null {
  if (value === undefined || value === null) return null;
  const fields = reader.record(value, 'propose_change');
  return {
    request: reader.text(fields.request, 'propose_change.request', SHAPE_LIMITS.request),
    why: reader.text(fields.why, 'propose_change.why', SHAPE_LIMITS.why),
  };
}

const DELIVERY_FIELD: Record<DeliveringStep, { field: string; limit: number; proposes: boolean }> = {
  answer: { field: 'answer', limit: SHAPE_LIMITS.answer, proposes: true },
  investigate: { field: 'diagnosis', limit: SHAPE_LIMITS.diagnosis, proposes: true },
  research: { field: 'report', limit: SHAPE_LIMITS.report, proposes: true },
  operate: { field: 'outcome', limit: SHAPE_LIMITS.outcome, proposes: false },
};

export function validateDelivery(
  step: DeliveringStep,
  input: Record<string, unknown>
): Validation<{ body: string; proposal: ChangeProposalInput | null }> {
  const reader = new Reader();
  const { field, limit, proposes } = DELIVERY_FIELD[step];
  return reader.result({
    body: reader.text(input[field], field, limit),
    proposal: proposes ? readProposal(reader, input.propose_change) : null,
  });
}

type ReshapeHandOver = { reason: string } & ({ shape: InquiryShape } | { steps: PipelineStep[] });

const PIPELINE_STEP_NAMES = COMPOSABLE_STEPS as readonly [PipelineStep, ...PipelineStep[]];

function readSteps(reader: Reader, value: unknown) {
  return reader
    .list(value, 'steps', COMPOSABLE_STEPS.length, 1)
    .map((step, index) => reader.pick(step, `steps[${index}]`, PIPELINE_STEP_NAMES));
}

export function validateWatchReport(input: Record<string, unknown>): Validation<WatchReport> {
  const reader = new Reader();
  const healthy = reader.flag(input.healthy, 'healthy');
  const issue = isGiven(input.issue) ? reader.record(input.issue, 'issue') : null;
  if (input.healthy === undefined) reader.errors.push('healthy is required: true when nothing is wrong.');
  else if (healthy && issue) {
    reader.errors.push('A healthy check has no issue. Leave issue out, or set healthy to false.');
  } else if (!healthy && !issue) {
    reader.errors.push('An unhealthy check needs issue: a title and the request for the task that fixes it.');
  }
  return reader.result({
    healthy,
    summary: reader.text(input.summary, 'summary', PROTOCOL_LIMITS.watchSummary),
    issue: issue
      ? {
          title: reader.text(issue.title, 'issue.title', PROTOCOL_LIMITS.watchIssueTitle),
          request: reader.text(issue.request, 'issue.request', PROTOCOL_LIMITS.watchIssueRequest),
        }
      : null,
  });
}

export function validateReshape(input: Record<string, unknown>): Validation<ReshapeHandOver> {
  const reader = new Reader();
  if (input.steps !== undefined && input.shape !== undefined) {
    reader.errors.push('Give either shape or steps, not both.');
  }
  if (input.steps === undefined) {
    const shape = reader.pick(input.shape, 'shape', ['answer', 'investigate', 'research']);
    return reader.result({ shape, reason: reader.text(input.reason, 'reason', SHAPE_LIMITS.reason) });
  }
  const steps = readSteps(reader, input.steps);
  return reader.result({ steps, reason: reader.text(input.reason, 'reason', SHAPE_LIMITS.reason) });
}
