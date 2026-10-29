import type { EvidenceKind, EvidenceStage, EvidenceTheme } from '../domain/types.ts';

export type Attention = 'critical' | 'high' | 'normal';

export interface CodeSpot {
  file: string;
  start: number;
  end: number;
  attention: Attention;
  why: string;
  title?: string;
  explain?: string;
}

export interface ReportSection {
  title: string;
  summary: string;
  spots: CodeSpot[];
}

export type CheckSource = 'plan' | 'agent' | 'repo';

export interface PlanCheck {
  label: string;
  command: string;
  phases: number[];
}

export interface TaskCheck extends PlanCheck {
  id: string;
  source: CheckSource;
}

export type CheckOutcome = 'pass' | 'fail' | 'skipped';

export type CheckNote = 'passed_alone' | 'fails_on_base';

export interface ReportCheck {
  id: string;
  label: string;
  command: string;
  outcome: CheckOutcome;
  detail: string | null;
  note?: CheckNote;
}

export type CheckChangeAction = 'add' | 'change' | 'remove';

export interface CheckChangeHandOver {
  action: CheckChangeAction;
  id: string | null;
  label: string | null;
  command: string | null;
  phases: number[] | null;
  reason: string;
}

export interface CheckChange {
  action: CheckChangeAction;
  check: TaskCheck;
  reason: string;
}

export interface JudgementAlternative {
  option: string;
  rejected: string;
}

export interface JudgementCall {
  title: string;
  call: string;
  reason: string;
  file: string | null;
  line: number | null;
  end?: number | null;
  alternatives?: JudgementAlternative[];
}

export interface ReportRisk {
  title: string;
  risk: string;
  file: string | null;
  line: number | null;
  end: number | null;
}

export type MergeStepTiming = 'pre_merge' | 'post_merge';

export type MergeStepKind = 'env' | 'secret' | 'migration' | 'deploy' | 'config' | 'other';

export interface MergeStep {
  when: MergeStepTiming;
  kind: MergeStepKind;
  title: string;
  detail: string;
  command: string | null;
}

export interface CarriedMergeStep extends MergeStep {
  round: number;
  done: boolean;
}

export type ManualTestTargetKind = 'url' | 'file' | 'command' | 'screen';

export interface ManualTestTarget {
  kind: ManualTestTargetKind;
  value: string;
}

export interface ManualTestStep {
  action: string;
  target: ManualTestTarget | null;
  expect: string;
}

export interface ReportTesting {
  automated: string[];
  manual: ManualTestStep[];
}

export interface WatchdogSource {
  server: string;
  data: string;
}

export interface WatchdogSourceRequest {
  data: string;
  evidence: string;
  suggestions: string[];
}

export type WatchdogStart = 'merge' | 'production';

export interface WatchdogSpec {
  title: string;
  check: string;
  source: WatchdogSource | null;
  sourceRequest: WatchdogSourceRequest | null;
  firstCheckMinutes: number | null;
  maxGapHours: number | null;
  forHours: number | null;
  startsOn: WatchdogStart;
  productionCheck: string | null;
}

export interface WatchIssue {
  title: string;
  request: string;
}

export interface WatchReport {
  live: boolean | null;
  healthy: boolean;
  summary: string;
  issue: WatchIssue | null;
}

export interface ReportWalkthrough {
  approach: string;
  flow: string;
  risks: ReportRisk[];
  testing: ReportTesting;
  steps?: MergeStep[];
  watchdogs?: WatchdogSpec[];
}

export type ReportWalkthroughRevision = Partial<ReportWalkthrough>;

export interface FixHandOver {
  summary: string;
  walkthrough: ReportWalkthroughRevision | null;
  checks: string[];
  checkChanges: CheckChangeHandOver[];
  evidenceKept: string[];
}

export interface WorkReport {
  headline: string;
  sections: ReportSection[];
  checks: ReportCheck[];
  judgementCalls: JudgementCall[];
  walkthrough?: ReportWalkthrough | null;
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
  verification: PlanCheck[];
  questions: PlanQuestion[];
  operation?: string[];
  impact?: string;
  evidence?: Exclude<EvidenceKind, 'check'>[];
  approval?: boolean;
}

export interface ReviewFinding {
  severity: 'blocking' | 'should_fix' | 'optional';
  file: string | null;
  line: number | null;
  end?: number | null;
  title?: string;
  message: string;
  fix?: string;
  verdict?: 'fix' | 'dismiss';
  verdictNote?: string | null;
}

export interface ReviewDisagreement {
  call: string;
  reason: string;
}

export interface ReviewHandOver {
  summary: string | null;
  findings: ReviewFinding[];
  disagreements: { call: number; reason: string }[];
}

export interface PhaseHandOver {
  summary: string;
  spots: CodeSpot[];
  judgementCalls: JudgementCall[];
  walkthrough: ReportWalkthrough | null;
  checkChanges: CheckChangeHandOver[];
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

export type EvidenceSource = { path: string } | { url: string } | { text: string };

interface EvidenceFacts {
  title: string;
  detail: string | null;
  width: number | null;
  theme: EvidenceTheme | null;
  key: string | null;
  replaces: string[];
}

export type LinkedEvidenceKind = Extract<EvidenceKind, 'test' | 'check'>;

export interface PieceHandOver extends EvidenceFacts {
  kind: Exclude<EvidenceKind, LinkedEvidenceKind>;
  stage: EvidenceStage | null;
  source: EvidenceSource;
}

export interface ComparisonPartHandOver {
  path: string;
  stage: EvidenceStage | null;
  label: string | null;
}

export interface ComparisonHandOver extends EvidenceFacts {
  kind: 'comparison';
  parts: ComparisonPartHandOver[];
}

export interface CheckLinkHandOver {
  kind: LinkedEvidenceKind;
  check: string;
  detail: string | null;
  replaces: string[];
}

export type EvidenceHandOver = PieceHandOver | ComparisonHandOver | CheckLinkHandOver;

export interface EvidenceRemovalHandOver {
  items: string[];
  reason: string;
}
