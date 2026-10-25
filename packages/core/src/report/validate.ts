import type { ChangeProposalInput, InquiryShape } from '../commands/index.ts';
import {
  type DeliveringStep,
  PIPELINE_ORDER,
  type PipelineStep,
  PLAN_EVIDENCE_KINDS,
  SHAPE_LIMITS,
} from '../domain/index.ts';
import type {
  Attention,
  CodeSpot,
  JudgementCall,
  PhaseHandOver,
  PlanDocument,
  PlanHandOver,
  QuestionHandOver,
  ReviewFinding,
  SuggestedTask,
  WaitHandOver,
} from './types.ts';

export const PROTOCOL_LIMITS = {
  phaseSummary: 240,
  spots: 6,
  why: 180,
  judgementCalls: 5,
  call: 120,
  reason: 240,
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
} as const;

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
  return {
    file: reader.text(record.file, `${path}.file`, PROTOCOL_LIMITS.path),
    start,
    end,
    attention: reader.pick(record.attention, `${path}.attention`, ATTENTION_LEVELS),
    why: reader.text(record.why, `${path}.why`, PROTOCOL_LIMITS.why),
  };
}

function readSpots(reader: Reader, value: unknown, path: string) {
  return reader
    .list(value, path, PROTOCOL_LIMITS.spots)
    .map((spot, index) => readSpot(reader, spot, `${path}[${index}]`));
}

function readJudgementCalls(reader: Reader, value: unknown): JudgementCall[] {
  return reader.list(value, 'judgement_calls', PROTOCOL_LIMITS.judgementCalls).map((raw, index) => {
    const path = `judgement_calls[${index}]`;
    const record = reader.record(raw, path);
    return {
      call: reader.text(record.call, `${path}.call`, PROTOCOL_LIMITS.call),
      reason: reader.text(record.reason, `${path}.reason`, PROTOCOL_LIMITS.reason),
      file: reader.optionalText(record.file, `${path}.file`, PROTOCOL_LIMITS.path),
      line: reader.optionalLine(record.line, `${path}.line`),
    };
  });
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
  });
}

export function validateFixHandOver(input: Record<string, unknown>): Validation<{ summary: string }> {
  const reader = new Reader();
  return reader.result({ summary: reader.text(input.summary, 'summary', PROTOCOL_LIMITS.phaseSummary) });
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

export function validateReview(
  input: Record<string, unknown>
): Validation<{ summary: string | null; findings: ReviewFinding[] }> {
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
  return reader.result({ summary, findings });
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

const PIPELINE_STEP_NAMES = PIPELINE_ORDER as readonly [PipelineStep, ...PipelineStep[]];

function readSteps(reader: Reader, value: unknown) {
  return reader
    .list(value, 'steps', PIPELINE_ORDER.length, 1)
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
