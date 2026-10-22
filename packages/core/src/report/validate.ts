import type {
  CodeSpot,
  PhaseHandOver,
  ReportDecision,
  ReviewFinding,
  SpecDocument,
  WorkReport,
} from './types.ts';

export const PROTOCOL_LIMITS = {
  headline: 100,
  phases: 6,
  phaseTitle: 60,
  phaseSummary: 240,
  spots: 6,
  why: 180,
  checks: 8,
  checkName: 40,
  checkDetail: 140,
  decisions: 5,
  decision: 120,
  reason: 240,
  goal: 300,
  planSteps: 8,
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
  findings: 12,
  finding: 280,
  path: 300,
} as const;

const MIN_PLAN_STEPS = 2;

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

class Reader {
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
    attention: reader.pick(record.attention, `${path}.attention`, ['critical', 'high', 'normal']),
    why: reader.text(record.why, `${path}.why`, PROTOCOL_LIMITS.why),
  };
}

function readSpots(reader: Reader, value: unknown, path: string, min = 0) {
  return reader
    .list(value, path, PROTOCOL_LIMITS.spots, min)
    .map((spot, index) => readSpot(reader, spot, `${path}[${index}]`));
}

function readDecisions(reader: Reader, value: unknown): ReportDecision[] {
  return reader.list(value, 'decisions', PROTOCOL_LIMITS.decisions).map((raw, index) => {
    const path = `decisions[${index}]`;
    const record = reader.record(raw, path);
    return {
      decision: reader.text(record.decision, `${path}.decision`, PROTOCOL_LIMITS.decision),
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
    decisions: readDecisions(reader, input.decisions),
  });
}

export function validateFixHandOver(input: Record<string, unknown>): Validation<{ summary: string }> {
  const reader = new Reader();
  return reader.result({ summary: reader.text(input.summary, 'summary', PROTOCOL_LIMITS.phaseSummary) });
}

export function validateWorkReport(input: Record<string, unknown>): Validation<WorkReport> {
  const reader = new Reader();
  const phases = reader.list(input.phases, 'phases', PROTOCOL_LIMITS.phases, 1).map((raw, index) => {
    const path = `phases[${index}]`;
    const record = reader.record(raw, path);
    return {
      title: reader.text(record.title, `${path}.title`, PROTOCOL_LIMITS.phaseTitle),
      summary: reader.text(record.summary, `${path}.summary`, PROTOCOL_LIMITS.phaseSummary),
      spots: readSpots(reader, record.spots, `${path}.spots`, 1),
    };
  });
  const checks = reader.list(input.checks, 'checks', PROTOCOL_LIMITS.checks).map((raw, index) => {
    const path = `checks[${index}]`;
    const record = reader.record(raw, path);
    return {
      name: reader.text(record.name, `${path}.name`, PROTOCOL_LIMITS.checkName),
      outcome: reader.pick(record.outcome, `${path}.outcome`, ['pass', 'fail', 'skipped']),
      detail: reader.optionalText(record.detail, `${path}.detail`, PROTOCOL_LIMITS.checkDetail),
    };
  });
  return reader.result({
    headline: reader.text(input.headline, 'headline', PROTOCOL_LIMITS.headline),
    phases,
    checks,
    decisions: readDecisions(reader, input.decisions),
  });
}

export function validateSpecDocument(input: Record<string, unknown>): Validation<SpecDocument> {
  const reader = new Reader();
  const files = reader.list(input.files, 'files', PROTOCOL_LIMITS.files).map((raw, index) => {
    const path = `files[${index}]`;
    const record = reader.record(raw, path);
    return {
      path: reader.text(record.path, `${path}.path`, PROTOCOL_LIMITS.path),
      change: reader.text(record.change, `${path}.change`, PROTOCOL_LIMITS.fileChange),
    };
  });
  const questions = reader.list(input.questions, 'questions', PROTOCOL_LIMITS.questions).map((raw, index) => {
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
  const plan = reader.list(input.plan, 'plan', PROTOCOL_LIMITS.planSteps).map((raw, index) => {
    const path = `plan[${index}]`;
    const record = reader.record(raw, path);
    return {
      title: reader.text(record.title, `${path}.title`, PROTOCOL_LIMITS.planTitle),
      detail: reader.text(record.detail, `${path}.detail`, PROTOCOL_LIMITS.planDetail),
    };
  });
  if (plan.length < MIN_PLAN_STEPS) reader.errors.push(`plan: at least ${MIN_PLAN_STEPS} phases.`);
  return reader.result({
    goal: reader.text(input.goal, 'goal', PROTOCOL_LIMITS.goal),
    plan,
    behaviour: readTextList(
      reader,
      input.behaviour,
      'behaviour',
      PROTOCOL_LIMITS.behaviour,
      PROTOCOL_LIMITS.behaviourItem
    ),
    approach: reader.text(input.approach, 'approach', PROTOCOL_LIMITS.approach),
    files,
    outOfScope: readTextList(
      reader,
      input.out_of_scope,
      'out_of_scope',
      PROTOCOL_LIMITS.listItems,
      PROTOCOL_LIMITS.listItem
    ),
    verification: readTextList(
      reader,
      input.verification,
      'verification',
      PROTOCOL_LIMITS.listItems,
      PROTOCOL_LIMITS.listItem
    ),
    questions,
  });
}

export function validateFindings(input: Record<string, unknown>): Validation<ReviewFinding[]> {
  const reader = new Reader();
  const findings = reader.list(input.findings, 'findings', PROTOCOL_LIMITS.findings).map((raw, index) => {
    const path = `findings[${index}]`;
    const record = reader.record(raw, path);
    const line = reader.optionalLine(record.line, `${path}.line`);
    const end = reader.optionalLine(record.end, `${path}.end`) ?? line;
    reader.range(line, end, path, 'line');
    return {
      severity: reader.pick(record.severity, `${path}.severity`, ['blocking', 'suggestion']),
      file: reader.optionalText(record.file, `${path}.file`, PROTOCOL_LIMITS.path),
      line,
      end,
      message: reader.text(record.message, `${path}.message`, PROTOCOL_LIMITS.finding),
    };
  });
  return reader.result(findings);
}
