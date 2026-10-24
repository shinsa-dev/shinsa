import type { EvidenceKind } from '../domain/types.ts';

export type Attention = 'critical' | 'high' | 'normal';

export interface CodeSpot {
  file: string;
  start: number;
  end: number;
  attention: Attention;
  why: string;
}

export interface ReportSection {
  title: string;
  summary: string;
  spots: CodeSpot[];
}

export interface ReportCheck {
  name: string;
  outcome: 'pass' | 'fail' | 'skipped';
  detail: string | null;
}

export interface JudgementCall {
  call: string;
  reason: string;
  file: string | null;
  line: number | null;
}

export interface WorkReport {
  headline: string;
  sections: ReportSection[];
  checks: ReportCheck[];
  judgementCalls: JudgementCall[];
}

export interface PlanFile {
  path: string;
  change: string;
}

export interface PlanQuestion {
  question: string;
  options: string[];
  recommendation: string | null;
}

export interface PlanPhase {
  title: string;
  detail: string;
}

export interface PlanDocument {
  goal: string;
  phases: PlanPhase[];
  behaviour: string[];
  approach: string;
  files: PlanFile[];
  outOfScope: string[];
  verification: string[];
  questions: PlanQuestion[];
  operation?: string[];
  impact?: string;
  evidence?: Exclude<EvidenceKind, 'check'>[];
  checks?: string[];
  approval?: boolean;
}

export interface ReviewFinding {
  severity: 'blocking' | 'suggestion';
  file: string | null;
  line: number | null;
  end?: number | null;
  message: string;
  verdict?: 'fix' | 'dismiss';
  verdictNote?: string | null;
}

export interface PhaseHandOver {
  summary: string;
  spots: CodeSpot[];
  judgementCalls: JudgementCall[];
}

export interface PlanHandOver {
  document: PlanDocument;
  changeSummary: string | null;
}

export interface QuestionHandOver {
  question: string;
  context: string | null;
  choices: string[];
  recommendation: string | null;
}

export interface WaitHandOver {
  checkInMinutes: number;
  notes: string;
  timeoutMinutes: number | null;
  maxAttempts: number | null;
}

export interface SuggestedTask {
  title: string;
  request: string;
  why: string;
  waitsOnThis: boolean;
  splitOff?: boolean;
}
