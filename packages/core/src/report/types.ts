export type Attention = 'critical' | 'high' | 'normal';

export interface CodeSpot {
  file: string;
  start: number;
  end: number;
  attention: Attention;
  why: string;
}

export interface ReportPhase {
  title: string;
  summary: string;
  spots: CodeSpot[];
}

export interface ReportCheck {
  name: string;
  outcome: 'pass' | 'fail' | 'skipped';
  detail: string | null;
}

export interface ReportDecision {
  decision: string;
  reason: string;
  file: string | null;
  line: number | null;
}

export interface WorkReport {
  headline: string;
  phases: ReportPhase[];
  checks: ReportCheck[];
  decisions: ReportDecision[];
}

export interface SpecFile {
  path: string;
  change: string;
}

export interface SpecQuestion {
  question: string;
  options: string[];
  recommendation: string | null;
}

export interface PlanStep {
  title: string;
  detail: string;
}

export interface SpecDocument {
  goal: string;
  plan: PlanStep[];
  behaviour: string[];
  approach: string;
  files: SpecFile[];
  outOfScope: string[];
  verification: string[];
  questions: SpecQuestion[];
}

export interface ReviewFinding {
  severity: 'blocking' | 'suggestion';
  file: string | null;
  line: number | null;
  end?: number | null;
  message: string;
}

export interface PhaseHandOver {
  summary: string;
  spots: CodeSpot[];
  decisions: ReportDecision[];
}
