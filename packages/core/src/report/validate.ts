import type { ChangeProposalInput, InquiryShape } from '../commands/index.ts';
import { describeWholeSuiteRefusal, isWholeSuiteCommand } from '../domain/checks.ts';
import {
  COMPOSABLE_STEPS,
  type DeliveringStep,
  EVIDENCE_KINDS,
  EVIDENCE_STAGES,
  EVIDENCE_THEMES,
  FEEDBACK_LIMITS,
  isEvidenceKey,
  MEMORY_LIMITS,
  MEMORY_SCOPES,
  type MemoryScope,
  type PipelineStep,
  PLAN_EVIDENCE_KINDS,
  SHAPE_LIMITS,
  WATCHDOG_SETTING_LIMITS,
} from '../domain/index.ts';
import type { EvidenceItemKind } from '../domain/types.ts';
import { createTesting, isWebUrl, MANUAL_TEST_TARGETS, parseTestFile } from './testing.ts';
import type {
  Attention,
  CheckChangeAction,
  CheckChangeHandOver,
  CodeSpot,
  ComparisonPartHandOver,
  EvidenceHandOver,
  EvidenceRemovalHandOver,
  EvidenceSource,
  FixHandOver,
  FixReply,
  JudgementAlternative,
  JudgementCall,
  ManualTestStep,
  ManualTestTarget,
  MergeStep,
  MergeStepKind,
  MergeStepTiming,
  PhaseHandOver,
  PlanCheck,
  PlanDocument,
  PlanHandOver,
  QuestionHandOver,
  ReplyOutcome,
  ReplyPoint,
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
  WatchdogStart,
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
  watchdogEvidence: 600,
  watchdogSuggestions: 4,
  watchdogSuggestion: 160,
  watchdogFirstCheckMinutes: WATCHDOG_SETTING_LIMITS.firstCheckMinutes,
  watchdogMaxGapHours: WATCHDOG_SETTING_LIMITS.maxGapHours,
  watchdogForHours: WATCHDOG_SETTING_LIMITS.hours,
  watchdogProductionCheck: 400,
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
  checks: 12,
  checkLabel: 60,
  checkCommand: 200,
  checkChanges: 6,
  checkReason: 200,
  checkId: 12,
  evidenceTitle: 80,
  evidenceDetail: 280,
  evidenceWidth: 7_680,
  evidenceText: 40_000,
  evidenceUrl: 2_000,
  evidenceParts: 6,
  evidenceLabel: 40,
  evidenceKey: 60,
  evidenceItems: 24,
  evidenceReason: 200,
  replyHeadline: 240,
  replyPoints: 8,
  replyAsk: 160,
  replyNote: 280,
  replyNext: 1_200,
} as const;

export const REPLY_OUTCOMES: readonly [ReplyOutcome, ...ReplyOutcome[]] = ['done', 'answered', 'not_changed'];

export const ATTACHED_EVIDENCE_KINDS: readonly [EvidenceItemKind, ...EvidenceItemKind[]] = [
  ...EVIDENCE_KINDS,
  'comparison',
];

export const WATCHDOG_STARTS: readonly [WatchdogStart, ...WatchdogStart[]] = ['merge', 'production'];

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

export const CHECK_CHANGE_ACTIONS: readonly [CheckChangeAction, ...CheckChangeAction[]] = [
  'add',
  'change',
  'remove',
];

const LINKED_EVIDENCE_KINDS = ['test', 'check'] as const;

export const ATTENTION_LEVELS: readonly [Attention, ...Attention[]] = ['critical', 'high', 'normal'];

export const FINDING_SEVERITIES: readonly [ReviewFinding['severity'], ...ReviewFinding['severity'][]] = [
  'blocking',
  'should_fix',
  'optional',
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

const SHIPPING_COMMAND = /\bgit\s+(?:-C\s+\S+\s+)*(?:add|commit|push)\b|\bgh\s+pr\s+(?:create|merge)\b/;

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
    if (step.command && SHIPPING_COMMAND.test(step.command)) {
      reader.errors.push(
        `walkthrough.steps[${index}].command stages, commits, pushes or opens a pull request, which is never the human's step. Shinsa commits and pushes this repository; file work in another repository with \`create_task\` instead.`
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

function isNamedIn(text: string, server: string) {
  const escaped = server.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(text);
}

function isCheckedIn(evidence: string, server: string) {
  return (evidence.match(/\bchecked\b[^.;\n]*/gi) ?? []).some((clause) => isNamedIn(clause, server));
}

export function listHeldSourceRequests(
  watchdogs: readonly WatchdogSpec[],
  serverNames: readonly string[],
  path = 'walkthrough.watchdogs'
) {
  return watchdogs.flatMap((watchdog, index) => {
    const request = watchdog.sourceRequest;
    if (!request) return [];
    const held = serverNames.filter(
      (server) =>
        request.suggestions.some((suggestion) => isNamedIn(suggestion, server)) &&
        !isCheckedIn(request.evidence, server)
    );
    return held.map(
      (server) =>
        `${path}[${index}].source_request suggests \`${server}\`, a server you already have. Check with its tools whether it reaches the data and give it as the \`source\`; only when it cannot, write in \`evidence\` “checked ${server}” and why it falls short.`
    );
  });
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
    firstCheckMinutes: reader.optionalCount(
      record.first_check_minutes,
      `${path}.first_check_minutes`,
      PROTOCOL_LIMITS.watchdogFirstCheckMinutes
    ),
    maxGapHours: reader.optionalCount(
      record.max_gap_hours,
      `${path}.max_gap_hours`,
      PROTOCOL_LIMITS.watchdogMaxGapHours
    ),
    forHours: reader.optionalCount(record.for_hours, `${path}.for_hours`, PROTOCOL_LIMITS.watchdogForHours),
    ...readWatchdogStart(reader, record, path),
  };
}

function readWatchdogStart(reader: Reader, record: Record<string, unknown>, path: string) {
  const startsOn = isGiven(record.starts)
    ? reader.pick(record.starts, `${path}.starts`, WATCHDOG_STARTS)
    : 'merge';
  const productionCheck = reader.optionalText(
    record.production_check,
    `${path}.production_check`,
    PROTOCOL_LIMITS.watchdogProductionCheck
  );
  if (startsOn === 'production' && productionCheck === null) {
    reader.errors.push(
      `${path}.production_check is required when it starts on production: how to tell the merged change is live there.`
    );
  }
  return { startsOn, productionCheck: startsOn === 'production' ? productionCheck : null };
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
    if (
      watchdog.firstCheckMinutes !== null &&
      watchdog.forHours !== null &&
      watchdog.firstCheckMinutes > watchdog.forHours * 60
    ) {
      reader.errors.push(
        `walkthrough.watchdogs[${index}] checks first after ${watchdog.firstCheckMinutes} minutes but watches for only ${watchdog.forHours} hours; check at least once in the window.`
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

function readCheckCommand(reader: Reader, value: unknown, path: string) {
  const command = reader.text(value, path, PROTOCOL_LIMITS.checkCommand);
  if (command && isWholeSuiteCommand(command)) reader.errors.push(describeWholeSuiteRefusal(path, command));
  return command;
}

function readPhaseNumbers(reader: Reader, value: unknown, path: string, phases: number | null) {
  const numbers = reader
    .list(value, path, PROTOCOL_LIMITS.planPhases, 1)
    .map((raw, index) => reader.count(raw, `${path}[${index}]`, phases ?? PROTOCOL_LIMITS.planPhases));
  if (new Set(numbers).size !== numbers.length) reader.errors.push(`${path} names a phase twice.`);
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function readOptionalPhaseNumbers(reader: Reader, value: unknown, path: string) {
  if (!isGiven(value)) return null;
  return readPhaseNumbers(reader, value, path, null);
}

function readCheckChange(reader: Reader, raw: unknown, path: string): CheckChangeHandOver {
  const record = reader.record(raw, path);
  const action = reader.pick(record.action, `${path}.action`, CHECK_CHANGE_ACTIONS);
  const id = action === 'add' ? null : reader.text(record.id, `${path}.id`, PROTOCOL_LIMITS.checkId);
  const change = {
    action,
    id,
    label: reader.optionalText(record.label, `${path}.label`, PROTOCOL_LIMITS.checkLabel),
    command: isGiven(record.command) ? readCheckCommand(reader, record.command, `${path}.command`) : null,
    phases: readOptionalPhaseNumbers(reader, record.phases, `${path}.phases`),
    reason: reader.text(record.reason, `${path}.reason`, PROTOCOL_LIMITS.checkReason),
  };
  if (record.action === 'add' && (change.label === null || change.command === null)) {
    reader.errors.push(`${path} adds a check: give its label and its command.`);
  }
  if (
    record.action === 'change' &&
    change.label === null &&
    change.command === null &&
    change.phases === null
  ) {
    reader.errors.push(`${path} changes a check: give its new label, command or phases.`);
  }
  return change;
}

function readCheckChanges(reader: Reader, value: unknown) {
  return reader
    .list(value, 'check_changes', PROTOCOL_LIMITS.checkChanges)
    .map((raw, index) => readCheckChange(reader, raw, `check_changes[${index}]`));
}

function readCheckIds(reader: Reader, value: unknown) {
  const ids = readTextList(reader, value, 'checks', PROTOCOL_LIMITS.checks, PROTOCOL_LIMITS.checkId);
  return [...new Set(ids)];
}

export function validatePhaseHandOver(input: Record<string, unknown>): Validation<PhaseHandOver> {
  const reader = new Reader();
  return reader.result({
    summary: reader.text(input.summary, 'summary', PROTOCOL_LIMITS.phaseSummary),
    spots: readSpots(reader, input.spots, 'spots'),
    judgementCalls: readJudgementCalls(reader, input.judgement_calls),
    walkthrough: readWalkthrough(reader, input.walkthrough),
    checkChanges: readCheckChanges(reader, input.check_changes),
  });
}

function readReplyPoints(reader: Reader, input: unknown): ReplyPoint[] {
  return reader.list(input, 'reply.points', PROTOCOL_LIMITS.replyPoints, 1).map((raw, index) => {
    const path = `reply.points[${index}]`;
    const record = reader.record(raw, path);
    return {
      ask: reader.text(record.ask, `${path}.ask`, PROTOCOL_LIMITS.replyAsk),
      outcome: reader.pick(record.outcome, `${path}.outcome`, REPLY_OUTCOMES),
      note: reader.text(record.note, `${path}.note`, PROTOCOL_LIMITS.replyNote),
    };
  });
}

function readReply(reader: Reader, input: unknown): FixReply | null {
  if (input === undefined || input === null) return null;
  const record = reader.record(input, 'reply');
  return {
    headline: reader.text(record.headline, 'reply.headline', PROTOCOL_LIMITS.replyHeadline),
    points: readReplyPoints(reader, record.points),
    next: reader.optionalText(record.next, 'reply.next', PROTOCOL_LIMITS.replyNext),
  };
}

export function validateFixHandOver(input: Record<string, unknown>): Validation<FixHandOver> {
  const reader = new Reader();
  return reader.result({
    summary: reader.text(input.summary, 'summary', PROTOCOL_LIMITS.phaseSummary),
    reply: readReply(reader, input.reply),
    walkthrough: readWalkthroughRevision(reader, input.walkthrough),
    checks: readCheckIds(reader, input.checks),
    checkChanges: readCheckChanges(reader, input.check_changes),
    evidenceKept: readEvidenceRefs(reader, input.evidence_kept, 'evidence_kept'),
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

function readPlanChecks(reader: Reader, input: unknown, phases: number): PlanCheck[] {
  const checks = reader.list(input, 'verification', PROTOCOL_LIMITS.checks).map((raw, index) => {
    const path = `verification[${index}]`;
    const record = reader.record(raw, path);
    return {
      label: reader.text(record.label, `${path}.label`, PROTOCOL_LIMITS.checkLabel),
      command: readCheckCommand(reader, record.command, `${path}.command`),
      phases: readPhaseNumbers(reader, record.phases, `${path}.phases`, Math.max(1, phases)),
    };
  });
  const commands = checks.map((check) => check.command);
  if (new Set(commands).size !== commands.length) reader.errors.push('verification lists a command twice.');
  return checks;
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
    verification: readPlanChecks(reader, input.verification, phases.length),
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
  return {
    ...(impact === null ? {} : { impact }),
    ...(evidence.length > 0 ? { evidence } : {}),
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

function readEvidenceRefs(reader: Reader, value: unknown, path: string) {
  const refs = readTextList(reader, value, path, PROTOCOL_LIMITS.evidenceItems, PROTOCOL_LIMITS.evidenceKey);
  return [...new Set(refs)];
}

function readEvidenceKey(reader: Reader, value: unknown) {
  const key = reader.optionalText(value, 'key', PROTOCOL_LIMITS.evidenceKey);
  if (key !== null && !isEvidenceKey(key)) {
    reader.errors.push('key takes lower-case letters, digits and single hyphens, like settings-dark-900.');
  }
  return key;
}

function readEvidenceFacts(reader: Reader, input: Record<string, unknown>) {
  return {
    title: reader.text(input.title, 'title', PROTOCOL_LIMITS.evidenceTitle),
    detail: reader.optionalText(input.detail, 'detail', PROTOCOL_LIMITS.evidenceDetail),
    width: reader.optionalCount(input.width, 'width', PROTOCOL_LIMITS.evidenceWidth),
    theme: readOptionalPick(reader, input.theme, 'theme', EVIDENCE_THEMES),
    key: readEvidenceKey(reader, input.key),
    replaces: readEvidenceRefs(reader, input.replaces, 'replaces'),
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

function readCheckLink(reader: Reader, input: Record<string, unknown>) {
  const given = ['path', 'url', 'text', 'parts', 'stage', 'width', 'theme', 'key'].filter((field) =>
    isGiven(input[field])
  );
  if (given.length > 0) {
    reader.errors.push(
      `A test or check run is a check Shinsa runs: give \`check\`, its id, and leave out ${given.join(', ')}. Add the command with \`check_changes\` first when it is not a check yet.`
    );
  }
  return {
    check: reader.text(input.check, 'check', PROTOCOL_LIMITS.checkId),
    detail: reader.optionalText(input.detail, 'detail', PROTOCOL_LIMITS.evidenceDetail),
    replaces: readEvidenceRefs(reader, input.replaces, 'replaces'),
  };
}

function isLinkedKind(kind: EvidenceItemKind): kind is (typeof LINKED_EVIDENCE_KINDS)[number] {
  return (LINKED_EVIDENCE_KINDS as readonly EvidenceItemKind[]).includes(kind);
}

export function validateEvidence(input: Record<string, unknown>): Validation<EvidenceHandOver> {
  const reader = new Reader();
  const kind = reader.pick(input.kind, 'kind', ATTACHED_EVIDENCE_KINDS);
  if (isLinkedKind(kind)) return reader.result<EvidenceHandOver>({ kind, ...readCheckLink(reader, input) });
  if (isGiven(input.check)) reader.errors.push('check is only for kind test or check.');
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

export function validateEvidenceRemoval(input: Record<string, unknown>): Validation<EvidenceRemovalHandOver> {
  const reader = new Reader();
  const items = readEvidenceRefs(reader, input.items, 'items');
  if (items.length === 0 && reader.errors.length === 0) reader.errors.push('items names no evidence.');
  return reader.result({
    items,
    reason: reader.text(input.reason, 'reason', PROTOCOL_LIMITS.evidenceReason),
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

export function validateMemoryProposal(
  input: Record<string, unknown>
): Validation<{ scope: MemoryScope; text: string; why: string }> {
  const reader = new Reader();
  return reader.result({
    scope: reader.pick(input.scope, 'scope', MEMORY_SCOPES),
    text: reader.text(input.text, 'text', MEMORY_LIMITS.text),
    why: reader.text(input.why, 'why', MEMORY_LIMITS.why),
  });
}

export function validateFeedbackReport(input: Record<string, unknown>): Validation<{ note: string }> {
  const reader = new Reader();
  return reader.result({ note: reader.text(input.feedback, 'feedback', FEEDBACK_LIMITS.note) });
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
